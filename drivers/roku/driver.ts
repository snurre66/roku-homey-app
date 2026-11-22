import Homey from 'homey';
import {
  RokuDeviceInfo,
  RokuEcpClient,
  ROKU_FORBIDDEN_INSTRUCTION,
} from '../../lib/RokuEcpClient';

export interface PairDeviceCandidate {
  name: string;
  data: {
    id: string;
  };
  settings: {
    host: string;
    port: number;
    poll_interval: number;
  };
  store: {
    host: string;
    port: number;
    isTv: boolean;
    modelName?: string;
    vendorName?: string;
    isManualFallback?: boolean;
  };
}

const MANUAL_FALLBACK_ID = '__manual_ip_entry__';

export class RokuDriver extends Homey.Driver {
  public async onInit(): Promise<void> {
    this.log('RokuDriver initialized');
  }

  /**
   * Builds a Homey pairing device descriptor from `GET /query/device-info`.
   * Uses `<serial-number>` as Homey `data.id`, `<friendly-device-name>` as device name,
   * and records `<is-tv>` in device store.
   */
  public static buildPairCandidate(
    deviceInfo: RokuDeviceInfo,
    host: string,
    port = 8060,
  ): PairDeviceCandidate {
    return {
      name: deviceInfo.friendlyDeviceName,
      data: {
        id: deviceInfo.serialNumber,
      },
      settings: {
        host,
        port,
        poll_interval: 10,
      },
      store: {
        host,
        port,
        isTv: deviceInfo.isTv,
        modelName: deviceInfo.modelName,
        vendorName: deviceInfo.vendorName,
      },
    };
  }

  /**
   * Discovers Roku devices on the local network via SSDP (`roku:ecp`) and probes `GET /query/device-info`.
   */
  public async discoverDevicesViaSsdp(): Promise<PairDeviceCandidate[]> {
    const candidates: PairDeviceCandidate[] = [];
    const seenSerials = new Set<string>();

    try {
      const strategy = this.getDiscoveryStrategy();
      const results = strategy.getDiscoveryResults();

      await Promise.all(
        Object.values(results).map(async (discoveryResult) => {
          const ssdpResult = discoveryResult as Homey.DiscoveryResultSSDP;
          const host = ssdpResult.address;
          if (!host) {
            return;
          }

          let port = 8060;
          const locationHeader = ssdpResult.headers?.location;
          if (typeof locationHeader === 'string') {
            try {
              const parsedUrl = new URL(locationHeader);
              if (parsedUrl.port) {
                port = Number(parsedUrl.port);
              }
            } catch {
              // default to 8060
            }
          }

          try {
            const client = new RokuEcpClient({ host, port, timeoutMs: 3500 });
            const info = await client.getDeviceInfo();
            if (!seenSerials.has(info.serialNumber)) {
              seenSerials.add(info.serialNumber);
              candidates.push(RokuDriver.buildPairCandidate(info, host, port));
            }
          } catch (err) {
            this.error(`Failed to query discovered Roku at ${host}:${port}:`, err);
          }
        }),
      );
    } catch (err) {
      this.error('SSDP discovery lookup failed:', err);
    }

    return candidates;
  }

  /**
   * Custom pairing wizard supporting:
   * 1. Automatic SSDP discovery (`list_devices`)
   * 2. Fallback manual IP address entry (`manual_ip`)
   * 3. Roku OS 11.5+ HTTP 403 Forbidden permission verification (`verify_device`)
   */
  public async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let selectedDevices: PairDeviceCandidate[] = [];

    session.setHandler('list_devices', async () => {
      const discovered = await this.discoverDevicesViaSsdp();

      // Always append a manual IP fallback option so users across VLANs/subnets or
      // when SSDP is empty can enter their Roku IP directly.
      const manualEntryOption: PairDeviceCandidate = {
        name: 'Enter Roku IP Address Manually...',
        data: {
          id: MANUAL_FALLBACK_ID,
        },
        settings: {
          host: '',
          port: 8060,
          poll_interval: 10,
        },
        store: {
          host: '',
          port: 8060,
          isTv: true,
          isManualFallback: true,
        },
      };

      return [...discovered, manualEntryOption];
    });

    session.setHandler('list_devices_selection', async (devices: PairDeviceCandidate[]) => {
      selectedDevices = devices || [];
    });

    session.setHandler(
      'manual_connect',
      async ({ host, port }: { host: string; port?: number }) => {
        const cleanHost = (host || '').trim();
        const cleanPort = Number(port) || 8060;

        if (!cleanHost) {
          throw new Error('Please provide a valid Roku IP address.');
        }

        const client = new RokuEcpClient({
          host: cleanHost,
          port: cleanPort,
          timeoutMs: 4000,
        });

        try {
          const deviceInfo = await client.getDeviceInfo();
          const candidate = RokuDriver.buildPairCandidate(deviceInfo, cleanHost, cleanPort);
          selectedDevices = [candidate];
          return candidate;
        } catch (err) {
          this.error(`Manual connect failed for ${cleanHost}:${cleanPort}:`, err);
          throw new Error(
            this.homey.__('errors.device_unreachable', {
              host: cleanHost,
              port: String(cleanPort),
            }) || `Unable to reach Roku device at ${cleanHost}:${cleanPort}.`,
          );
        }
      },
    );

    session.setHandler('verify_selected_device', async () => {
      const realDevices = selectedDevices.filter(
        (d) => d.data?.id !== MANUAL_FALLBACK_ID && !d.store?.isManualFallback,
      );

      if (realDevices.length === 0) {
        return {
          needsManualIp: true,
          forbidden: false,
        };
      }

      selectedDevices = realDevices;

      for (const candidate of selectedDevices) {
        const client = new RokuEcpClient({
          host: candidate.settings.host,
          port: candidate.settings.port,
          timeoutMs: 4000,
        });

        const permission = await client.verifyMobileAppControlPermission();
        if (!permission.allowed) {
          return {
            needsManualIp: false,
            forbidden: true,
            instruction: permission.instruction || ROKU_FORBIDDEN_INSTRUCTION,
          };
        }
      }

      return {
        needsManualIp: false,
        forbidden: false,
      };
    });

    // Called by the built-in add_devices view template when it fetches devices to create
    session.setHandler('get_devices', async () => {
      return selectedDevices.filter(
        (d) => d.data?.id !== MANUAL_FALLBACK_ID && !d.store?.isManualFallback,
      );
    });
  }
}

module.exports = RokuDriver;
