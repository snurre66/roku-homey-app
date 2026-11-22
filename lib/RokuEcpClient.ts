export const ROKU_FORBIDDEN_INSTRUCTION =
  'Enable Settings → System → Advanced system settings → Control by mobile apps → Permissive';

export type RokuKey =
  | 'Home'
  | 'Rev'
  | 'Fwd'
  | 'Play'
  | 'Select'
  | 'Left'
  | 'Right'
  | 'Down'
  | 'Up'
  | 'Back'
  | 'InstantReplay'
  | 'Info'
  | 'Backspace'
  | 'Search'
  | 'Enter'
  | 'FindRemote'
  | 'VolumeDown'
  | 'VolumeMute'
  | 'VolumeUp'
  | 'PowerOff'
  | 'PowerOn'
  | 'ChannelUp'
  | 'ChannelDown'
  | 'InputTuner'
  | 'InputHDMI1'
  | 'InputHDMI2'
  | 'InputHDMI3'
  | 'InputHDMI4'
  | 'InputAV1';

export type RokuHdmiInput = 'InputHDMI1' | 'InputHDMI2' | 'InputHDMI3' | 'InputHDMI4';

export interface RokuDeviceInfo {
  serialNumber: string;
  deviceId?: string;
  friendlyDeviceName: string;
  defaultDeviceName?: string;
  userDeviceName?: string;
  modelName?: string;
  modelNumber?: string;
  vendorName?: string;
  softwareVersion?: string;
  powerMode: string;
  isOn: boolean;
  isTv: boolean;
  supportsFindRemote?: boolean;
}

export interface RokuApp {
  id: string;
  name: string;
  type?: string;
  version?: string;
}

export interface RokuActiveApp {
  id: string;
  name: string;
  isScreensaver: boolean;
}

export class RokuEcpForbiddenError extends Error {
  public readonly statusCode = 403;
  public readonly instruction = ROKU_FORBIDDEN_INSTRUCTION;

  constructor(endpoint: string) {
    super(
      `Roku returned HTTP 403 Forbidden on ${endpoint}. ${ROKU_FORBIDDEN_INSTRUCTION}`,
    );
    this.name = 'RokuEcpForbiddenError';
  }
}

export class RokuEcpHttpError extends Error {
  public readonly statusCode: number;
  public readonly endpoint: string;

  constructor(statusCode: number, endpoint: string, message?: string) {
    super(message || `Roku ECP HTTP ${statusCode} on ${endpoint}`);
    this.name = 'RokuEcpHttpError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }
}

/**
 * Decodes standard XML entities in element values and attributes.
 */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractXmlTag(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(xml);
  if (!match) {
    return undefined;
  }
  return decodeXmlEntities(match[1].trim());
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2]);
  }
  return attrs;
}

/**
 * Parses XML response from `GET /query/device-info`.
 */
export function parseDeviceInfoXml(xml: string): RokuDeviceInfo {
  const serialNumber =
    extractXmlTag(xml, 'serial-number') ||
    extractXmlTag(xml, 'device-id') ||
    extractXmlTag(xml, 'udn') ||
    '';

  if (!serialNumber) {
    throw new Error('Invalid Roku device-info XML: missing <serial-number>');
  }

  const friendlyDeviceName =
    extractXmlTag(xml, 'friendly-device-name') ||
    extractXmlTag(xml, 'user-device-name') ||
    extractXmlTag(xml, 'default-device-name') ||
    extractXmlTag(xml, 'model-name') ||
    `Roku (${serialNumber})`;

  const powerMode = extractXmlTag(xml, 'power-mode') || 'PowerOn';
  const normalizedPower = powerMode.toLowerCase();
  // PowerOn means active; DisplayOff / Headless / Standby / PowerOff means off
  const isOn = normalizedPower === 'poweron';

  const isTvRaw = (extractXmlTag(xml, 'is-tv') || 'false').toLowerCase();
  const isTv = isTvRaw === 'true' || isTvRaw === '1';

  const supportsFindRemoteRaw = (extractXmlTag(xml, 'supports-find-remote') || 'false').toLowerCase();

  return {
    serialNumber,
    deviceId: extractXmlTag(xml, 'device-id'),
    friendlyDeviceName,
    defaultDeviceName: extractXmlTag(xml, 'default-device-name'),
    userDeviceName: extractXmlTag(xml, 'user-device-name'),
    modelName: extractXmlTag(xml, 'model-name'),
    modelNumber: extractXmlTag(xml, 'model-number'),
    vendorName: extractXmlTag(xml, 'vendor-name'),
    softwareVersion: extractXmlTag(xml, 'software-version'),
    powerMode,
    isOn,
    isTv,
    supportsFindRemote: supportsFindRemoteRaw === 'true',
  };
}

/**
 * Parses XML response from `GET /query/apps`.
 */
export function parseAppsXml(xml: string): RokuApp[] {
  const apps: RokuApp[] = [];
  const appRegex = /<app(\s[^>]*)?>([\s\S]*?)<\/app>/gi;
  let match: RegExpExecArray | null;

  while ((match = appRegex.exec(xml)) !== null) {
    const attrs = parseAttributes(match[1] || '');
    const name = decodeXmlEntities(match[2].trim());
    if (attrs.id && name) {
      apps.push({
        id: attrs.id,
        name,
        type: attrs.type,
        version: attrs.version,
      });
    }
  }

  return apps;
}

/**
 * Parses XML response from `GET /query/active-app`.
 */
export function parseActiveAppXml(xml: string): RokuActiveApp {
  const activeBlockMatch = /<active-app(?:\s[^>]*)?>([\s\S]*?)<\/active-app>/i.exec(xml);
  const block = activeBlockMatch ? activeBlockMatch[1] : xml;

  const isScreensaver = /<screensaver(?:\s[^>]*)?>[\s\S]*?<\/screensaver>/i.test(block);
  const appMatch = /<app(\s[^>]*)?>([\s\S]*?)<\/app>/i.exec(block);

  if (appMatch) {
    const attrs = parseAttributes(appMatch[1] || '');
    const rawName = decodeXmlEntities(appMatch[2].trim());
    return {
      id: attrs.id || 'home',
      name: rawName || 'Roku',
      isScreensaver,
    };
  }

  return {
    id: 'home',
    name: 'Roku',
    isScreensaver,
  };
}

export interface RokuEcpClientOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Client for Roku's External Control Protocol (ECP).
 */
export class RokuEcpClient {
  private host: string;
  private port: number;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: RokuEcpClientOptions) {
    this.host = options.host.trim();
    this.port = options.port ?? 8060;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public getHost(): string {
    return this.host;
  }

  public getPort(): number {
    return this.port;
  }

  public setConnection(host: string, port = 8060): void {
    this.host = host.trim();
    this.port = port;
  }

  public getBaseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  private async request(method: 'GET' | 'POST', path: string): Promise<string> {
    const url = `${this.getBaseUrl()}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        signal: controller.signal,
      });

      if (response.status === 403) {
        throw new RokuEcpForbiddenError(`${method} ${path}`);
      }

      if (!response.ok) {
        throw new RokuEcpHttpError(response.status, `${method} ${path}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * GET /query/device-info
   * Returns device serial number, friendly name, power mode, and whether it is a Roku TV.
   */
  public async getDeviceInfo(): Promise<RokuDeviceInfo> {
    const xml = await this.request('GET', '/query/device-info');
    return parseDeviceInfoXml(xml);
  }

  /**
   * GET /query/apps
   * Returns list of all installed apps and their numeric IDs.
   */
  public async getApps(): Promise<RokuApp[]> {
    const xml = await this.request('GET', '/query/apps');
    return parseAppsXml(xml);
  }

  /**
   * GET /query/active-app
   * Returns currently running app name and ID.
   */
  public async getActiveApp(): Promise<RokuActiveApp> {
    const xml = await this.request('GET', '/query/active-app');
    return parseActiveAppXml(xml);
  }

  /**
   * POST /keypress/<key>
   * Sends a remote control key command.
   */
  public async keypress(key: RokuKey | string): Promise<void> {
    const encodedKey = encodeURIComponent(key);
    await this.request('POST', `/keypress/${encodedKey}`);
  }

  /**
   * POST /launch/<appId>
   * Launches a specific channel or app directly by ID.
   */
  public async launchApp(appId: string): Promise<void> {
    const encodedId = encodeURIComponent(appId);
    await this.request('POST', `/launch/${encodedId}`);
  }

  /**
   * Tests whether `POST /keypress/` is allowed by Roku OS 11.5+ "Control by mobile apps" setting.
   * Uses `POST /keypress/Lit_` or non-destructive check and catches HTTP 403 Forbidden.
   */
  public async verifyMobileAppControlPermission(): Promise<{ allowed: boolean; instruction?: string }> {
    try {
      // Sending Shift or Info/Lit_ check; Roku OS 11.5+ checks permission before evaluating the key
      await this.request('POST', '/keypress/Shift');
      return { allowed: true };
    } catch (error) {
      if (error instanceof RokuEcpForbiddenError) {
        return {
          allowed: false,
          instruction: error.instruction,
        };
      }
      // If a Roku model returns 400/404 for unknown key 'Shift', ECP control IS allowed (not 403)
      if (error instanceof RokuEcpHttpError && error.statusCode !== 403) {
        return { allowed: true };
      }
      throw error;
    }
  }
}
