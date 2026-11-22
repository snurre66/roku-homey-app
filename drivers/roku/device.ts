import Homey from 'homey';
import {
  RokuActiveApp,
  RokuApp,
  RokuEcpClient,
  RokuEcpForbiddenError,
  RokuHdmiInput,
  RokuKey,
  ROKU_FORBIDDEN_INSTRUCTION,
} from '../../lib/RokuEcpClient';

const TV_ONLY_CAPABILITIES = [
  'volume_up',
  'volume_down',
  'volume_mute',
  'channel_up',
  'channel_down',
] as const;

export class RokuDevice extends Homey.Device {
  private client!: RokuEcpClient;
  private pollTimer?: NodeJS.Timeout;
  private cachedApps: RokuApp[] = [];
  private lastAppsRefresh = 0;
  private currentActiveApp: RokuActiveApp = {
    id: 'home',
    name: 'Roku',
    isScreensaver: false,
  };
  private isTvDevice = true;

  public async onInit(): Promise<void> {
    const settings = this.getSettings();
    const store = this.getStore();

    const host = (settings.host || store.host || '').trim();
    const port = Number(settings.port || store.port || 8060);
    this.isTvDevice = Boolean(store.isTv ?? true);

    this.client = new RokuEcpClient({ host, port });

    this.log(`Initializing RokuDevice "${this.getName()}" (${host}:${port}, isTv=${this.isTvDevice})`);

    await this.adaptCapabilitiesForDeviceType(this.isTvDevice);
    this.registerCapabilityHandlers();

    // Perform initial poll and start periodic polling
    await this.pollDeviceState();
    this.startPolling();
  }

  /**
   * Adapts capabilities based on `<is-tv>` from `/query/device-info`.
   * Hides unsupported TV hardware capabilities (volume, channel) on Roku Streaming Sticks.
   */
  private async adaptCapabilitiesForDeviceType(isTv: boolean): Promise<void> {
    this.isTvDevice = isTv;

    for (const cap of TV_ONLY_CAPABILITIES) {
      if (!isTv && this.hasCapability(cap)) {
        try {
          await this.removeCapability(cap);
          this.log(`Removed TV-only capability "${cap}" for streaming stick "${this.getName()}"`);
        } catch (err) {
          this.error(`Failed to remove capability "${cap}":`, err);
        }
      } else if (isTv && !this.hasCapability(cap)) {
        try {
          await this.addCapability(cap);
          this.log(`Added TV capability "${cap}" for Roku TV "${this.getName()}"`);
        } catch (err) {
          this.error(`Failed to add capability "${cap}":`, err);
        }
      }
    }
  }

  private registerCapabilityHandlers(): void {
    // Power on/off
    this.registerCapabilityListener('onoff', async (value: boolean) => {
      const key: RokuKey = value ? 'PowerOn' : 'PowerOff';
      await this.executeKeypress(key);
    });

    // Playback / navigation capabilities
    this.registerCapabilityListener('speaker_playing', async (value: boolean) => {
      await this.executeKeypress('Play');
      await this.setCapabilityValue('speaker_playing', value).catch(this.error);
    });

    this.registerCapabilityListener('speaker_next', async () => {
      await this.executeKeypress('Fwd');
    });

    this.registerCapabilityListener('speaker_prev', async () => {
      await this.executeKeypress('Rev');
    });

    // TV-specific capabilities (registered when present)
    if (this.hasCapability('volume_up')) {
      this.registerCapabilityListener('volume_up', async () => {
        await this.executeKeypress('VolumeUp');
      });
    }

    if (this.hasCapability('volume_down')) {
      this.registerCapabilityListener('volume_down', async () => {
        await this.executeKeypress('VolumeDown');
      });
    }

    if (this.hasCapability('volume_mute')) {
      this.registerCapabilityListener('volume_mute', async () => {
        await this.executeKeypress('VolumeMute');
      });
    }

    if (this.hasCapability('channel_up')) {
      this.registerCapabilityListener('channel_up', async () => {
        await this.executeKeypress('ChannelUp');
      });
    }

    if (this.hasCapability('channel_down')) {
      this.registerCapabilityListener('channel_down', async () => {
        await this.executeKeypress('ChannelDown');
      });
    }
  }

  /**
   * Sends a remote keypress (`POST /keypress/<key>`) and gracefully handles HTTP 403 Forbidden
   * on Roku OS 11.5+ when "Control by mobile apps" is set to Default or Disabled.
   */
  public async executeKeypress(key: RokuKey | string): Promise<void> {
    try {
      await this.client.keypress(key);
      if (!this.getAvailable()) {
        await this.setAvailable();
      }
      await this.unsetWarning().catch(() => {});
    } catch (error) {
      await this.handleEcpError(error);
      throw error;
    }
  }

  /**
   * Launches an installed Roku channel (`POST /launch/<appId>`) and handles HTTP 403 Forbidden.
   */
  public async executeLaunchApp(appId: string): Promise<void> {
    try {
      await this.client.launchApp(appId);
      if (!this.getAvailable()) {
        await this.setAvailable();
      }
      await this.unsetWarning().catch(() => {});
      // Refresh active app state shortly after launching
      setTimeout(() => {
        this.pollDeviceState().catch((err) => this.error('Post-launch poll failed:', err));
      }, 1500);
    } catch (error) {
      await this.handleEcpError(error);
      throw error;
    }
  }

  /**
   * Switches HDMI input on Roku TVs (`POST /keypress/InputHDMI1..4`).
   */
  public async executeSwitchHdmiInput(input: RokuHdmiInput): Promise<void> {
    if (!this.isTvDevice) {
      throw new Error(this.homey.__('errors.not_a_tv') || 'Switching HDMI input is only supported on Roku TVs.');
    }
    await this.executeKeypress(input);
  }

  /**
   * Queries installed apps (`GET /query/apps`) for Flow card autocomplete dropdowns.
   */
  public async getInstalledApps(query = ''): Promise<Array<{ id: string; name: string; description?: string }>> {
    const now = Date.now();
    if (this.cachedApps.length === 0 || now - this.lastAppsRefresh > 30_000) {
      try {
        this.cachedApps = await this.client.getApps();
        this.lastAppsRefresh = now;
      } catch (err) {
        this.error('Failed to query installed apps from Roku:', err);
      }
    }

    const normalizedQuery = query.trim().toLowerCase();
    return this.cachedApps
      .filter((app) => !normalizedQuery || app.name.toLowerCase().includes(normalizedQuery))
      .map((app) => ({
        id: app.id,
        name: app.name,
        description: `App ID: ${app.id}`,
      }));
  }

  /**
   * Checks whether the given app is currently running (`GET /query/active-app`).
   */
  public async isAppRunning(appArg: { id?: string; name?: string }): Promise<boolean> {
    try {
      const activeApp = await this.client.getActiveApp();
      this.currentActiveApp = activeApp;
    } catch (err) {
      this.error('Failed to refresh active app during condition check, using cached state:', err);
    }

    if (appArg.id && this.currentActiveApp.id === String(appArg.id)) {
      return true;
    }
    if (
      appArg.name &&
      this.currentActiveApp.name.toLowerCase() === appArg.name.trim().toLowerCase()
    ) {
      return true;
    }
    return false;
  }

  /**
   * Polls `GET /query/device-info` and `GET /query/active-app` to synchronize Homey capabilities
   * and trigger `app_changed` / `onoff` flow cards.
   */
  public async pollDeviceState(): Promise<void> {
    if (!this.client.getHost()) {
      return;
    }

    try {
      const [deviceInfo, activeApp] = await Promise.all([
        this.client.getDeviceInfo(),
        this.client.getActiveApp(),
      ]);

      if (!this.getAvailable()) {
        await this.setAvailable();
      }

      // Check if isTv changed or wasn't stored yet
      if (deviceInfo.isTv !== this.isTvDevice) {
        await this.setStoreValue('isTv', deviceInfo.isTv);
        await this.adaptCapabilitiesForDeviceType(deviceInfo.isTv);
        this.registerCapabilityHandlers();
      }

      // Sync onoff capability from <power-mode> (PowerOn vs DisplayOff)
      if (this.hasCapability('onoff')) {
        const prevOnOff = this.getCapabilityValue('onoff');
        if (prevOnOff !== deviceInfo.isOn) {
          await this.setCapabilityValue('onoff', deviceInfo.isOn);
        }
      }

      // Sync roku_active_app custom capability and trigger app_changed Flow card
      const previousAppName = this.getCapabilityValue('roku_active_app');
      const previousAppId = this.currentActiveApp.id;
      this.currentActiveApp = activeApp;

      if (this.hasCapability('roku_active_app') && previousAppName !== activeApp.name) {
        await this.setCapabilityValue('roku_active_app', activeApp.name);
      }

      // Trigger app_changed flow card if the active app changed after initial load
      if (previousAppName !== null && (previousAppName !== activeApp.name || previousAppId !== activeApp.id)) {
        const appChangedTrigger = this.homey.flow.getDeviceTriggerCard('app_changed');
        await appChangedTrigger
          .trigger(this, {
            app_name: activeApp.name,
            app_id: activeApp.id,
          })
          .catch((err: unknown) => this.error('Failed to trigger app_changed flow card:', err));
      }
    } catch (error) {
      await this.handleEcpError(error);
    }
  }

  /**
   * Central handler for ECP errors, specifically surfacing the Roku OS 11.5+ HTTP 403 Forbidden
   * instructions in the device error/warning state.
   */
  private async handleEcpError(error: unknown): Promise<void> {
    if (error instanceof RokuEcpForbiddenError) {
      this.error('Roku ECP returned HTTP 403 Forbidden:', error.message);
      await this.setWarning(ROKU_FORBIDDEN_INSTRUCTION).catch(this.error);
      await this.setUnavailable(ROKU_FORBIDDEN_INSTRUCTION).catch(this.error);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.error('Roku ECP communication error:', message);
  }

  private startPolling(): void {
    this.stopPolling();
    const intervalSeconds = Math.max(3, Number(this.getSetting('poll_interval')) || 10);
    this.pollTimer = this.homey.setInterval(() => {
      this.pollDeviceState().catch((err) => this.error('Scheduled poll error:', err));
    }, intervalSeconds * 1000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  public async onSettings({
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    if (changedKeys.includes('host') || changedKeys.includes('port')) {
      const newHost = String(newSettings.host || '').trim();
      const newPort = Number(newSettings.port || 8060);

      const testClient = new RokuEcpClient({ host: newHost, port: newPort });
      // Validate connection before saving settings
      await testClient.getDeviceInfo();
      const perm = await testClient.verifyMobileAppControlPermission();

      this.client.setConnection(newHost, newPort);
      await this.setStoreValue('host', newHost);
      await this.setStoreValue('port', newPort);

      if (!perm.allowed) {
        await this.setWarning(ROKU_FORBIDDEN_INSTRUCTION).catch(this.error);
        await this.setUnavailable(ROKU_FORBIDDEN_INSTRUCTION).catch(this.error);
      } else {
        await this.unsetWarning().catch(() => {});
        await this.setAvailable().catch(this.error);
      }
    }

    if (changedKeys.includes('poll_interval')) {
      this.homey.setTimeout(() => this.startPolling(), 100);
    }
  }

  /**
   * Automatically updates IP address when Homey's SSDP discovery detects the Roku on a new IP.
   */
  public onDiscoveryResult(discoveryResult: Homey.DiscoveryResult): boolean {
    const ssdpResult = discoveryResult as Homey.DiscoveryResultSSDP;
    const usn = ssdpResult.headers?.usn || ssdpResult.id || '';
    return usn.includes(this.getData().id);
  }

  public async onDiscoveryAvailable(discoveryResult: Homey.DiscoveryResult): Promise<void> {
    const ssdpResult = discoveryResult as Homey.DiscoveryResultSSDP;
    if (ssdpResult.address) {
      await this.updateHostAddress(ssdpResult.address);
    }
  }

  public onDiscoveryAddressChanged(discoveryResult: Homey.DiscoveryResult): void {
    const ssdpResult = discoveryResult as Homey.DiscoveryResultSSDP;
    if (ssdpResult.address) {
      this.updateHostAddress(ssdpResult.address).catch(this.error);
    }
  }

  private async updateHostAddress(newAddress: string): Promise<void> {
    const currentHost = this.client.getHost();
    if (newAddress && newAddress !== currentHost) {
      this.log(`Updating Roku IP address via SSDP discovery: ${currentHost} -> ${newAddress}`);
      this.client.setConnection(newAddress, this.client.getPort());
      await this.setStoreValue('host', newAddress);
      await this.setSettings({ host: newAddress });
      await this.pollDeviceState();
    }
  }

  public async onUninit(): Promise<void> {
    this.stopPolling();
  }
}

module.exports = RokuDevice;
