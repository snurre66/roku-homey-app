import assert from 'node:assert/strict';
import {
  parseDeviceInfoXml,
  parseAppsXml,
  parseActiveAppXml,
  RokuEcpClient,
  RokuEcpForbiddenError,
  ROKU_FORBIDDEN_INSTRUCTION,
} from '../lib/RokuEcpClient';

const SAMPLE_TV_DEVICE_INFO_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<device-info>
  <udn>29504000-d406-1096-805d-b83e59999999</udn>
  <serial-number>YN00TV123456</serial-number>
  <device-id>S0A001234567</device-id>
  <vendor-name>TCL</vendor-name>
  <model-number>55S425</model-number>
  <model-name>55" TCL Roku TV</model-name>
  <friendly-device-name>Living Room Roku TV</friendly-device-name>
  <default-device-name>TCL Roku TV</default-device-name>
  <user-device-name>Living Room Roku TV</user-device-name>
  <software-version>12.5.0</software-version>
  <is-tv>true</is-tv>
  <power-mode>PowerOn</power-mode>
  <supports-find-remote>true</supports-find-remote>
</device-info>`;

const SAMPLE_STICK_DEVICE_INFO_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<device-info>
  <serial-number>X000STICK789</serial-number>
  <friendly-device-name>Bedroom Streaming Stick &amp; 4K</friendly-device-name>
  <is-tv>false</is-tv>
  <power-mode>DisplayOff</power-mode>
</device-info>`;

const SAMPLE_APPS_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<apps>
  <app id="12" type="appl" version="5.1.123">Netflix</app>
  <app id="837" type="appl" version="2.22.100">YouTube</app>
  <app id="13535" type="appl" version="7.9.0">Plex - Free Movies &amp; TV</app>
  <app id="tvinput.hdmi1" type="tvin" version="1.0.0">PlayStation 5</app>
</apps>`;

const SAMPLE_ACTIVE_APP_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<active-app>
  <app id="12" type="appl" version="5.1.123">Netflix</app>
</active-app>`;

async function runTests(): Promise<void> {
  console.log('Running Roku ECP unit tests...');

  // 1. Test parseDeviceInfoXml for Roku TV
  const tvInfo = parseDeviceInfoXml(SAMPLE_TV_DEVICE_INFO_XML);
  assert.equal(tvInfo.serialNumber, 'YN00TV123456');
  assert.equal(tvInfo.friendlyDeviceName, 'Living Room Roku TV');
  assert.equal(tvInfo.powerMode, 'PowerOn');
  assert.equal(tvInfo.isOn, true);
  assert.equal(tvInfo.isTv, true);

  // 2. Test parseDeviceInfoXml for Roku Streaming Stick (DisplayOff & is-tv=false)
  const stickInfo = parseDeviceInfoXml(SAMPLE_STICK_DEVICE_INFO_XML);
  assert.equal(stickInfo.serialNumber, 'X000STICK789');
  assert.equal(stickInfo.friendlyDeviceName, 'Bedroom Streaming Stick & 4K');
  assert.equal(stickInfo.powerMode, 'DisplayOff');
  assert.equal(stickInfo.isOn, false);
  assert.equal(stickInfo.isTv, false);

  // 3. Test parseAppsXml
  const apps = parseAppsXml(SAMPLE_APPS_XML);
  assert.equal(apps.length, 4);
  assert.deepEqual(apps[0], { id: '12', name: 'Netflix', type: 'appl', version: '5.1.123' });
  assert.deepEqual(apps[2], { id: '13535', name: 'Plex - Free Movies & TV', type: 'appl', version: '7.9.0' });

  // 4. Test parseActiveAppXml
  const activeApp = parseActiveAppXml(SAMPLE_ACTIVE_APP_XML);
  assert.equal(activeApp.id, '12');
  assert.equal(activeApp.name, 'Netflix');
  assert.equal(activeApp.isScreensaver, false);

  // 5. Test RokuEcpClient HTTP 403 Forbidden handling on Roku OS 11.5+
  const forbiddenFetch: typeof fetch = async () => {
    return new Response('Forbidden', { status: 403 });
  };
  const forbiddenClient = new RokuEcpClient({
    host: '192.168.1.50',
    port: 8060,
    fetchImpl: forbiddenFetch,
  });

  await assert.rejects(
    async () => {
      await forbiddenClient.keypress('PowerOn');
    },
    (err: unknown) => {
      assert.ok(err instanceof RokuEcpForbiddenError);
      assert.equal(err.statusCode, 403);
      assert.equal(err.instruction, ROKU_FORBIDDEN_INSTRUCTION);
      assert.ok(
        err.message.includes(
          'Enable Settings → System → Advanced system settings → Control by mobile apps → Permissive',
        ),
      );
      return true;
    },
  );

  const permCheck = await forbiddenClient.verifyMobileAppControlPermission();
  assert.equal(permCheck.allowed, false);
  assert.equal(
    permCheck.instruction,
    'Enable Settings → System → Advanced system settings → Control by mobile apps → Permissive',
  );

  // 6. Test RokuEcpClient endpoints routing
  const requestedUrls: Array<{ method: string; url: string }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';
    requestedUrls.push({ method, url });

    if (url.endsWith('/query/device-info')) {
      return new Response(SAMPLE_TV_DEVICE_INFO_XML, { status: 200 });
    }
    if (url.endsWith('/query/apps')) {
      return new Response(SAMPLE_APPS_XML, { status: 200 });
    }
    if (url.endsWith('/query/active-app')) {
      return new Response(SAMPLE_ACTIVE_APP_XML, { status: 200 });
    }
    return new Response('', { status: 200 });
  };

  const client = new RokuEcpClient({
    host: '192.168.1.99',
    port: 8060,
    fetchImpl: mockFetch,
  });

  const infoResult = await client.getDeviceInfo();
  assert.equal(infoResult.serialNumber, 'YN00TV123456');

  const appsResult = await client.getApps();
  assert.equal(appsResult.length, 4);

  const activeResult = await client.getActiveApp();
  assert.equal(activeResult.name, 'Netflix');

  await client.keypress('InputHDMI1');
  await client.launchApp('837');

  assert.deepEqual(requestedUrls, [
    { method: 'GET', url: 'http://192.168.1.99:8060/query/device-info' },
    { method: 'GET', url: 'http://192.168.1.99:8060/query/apps' },
    { method: 'GET', url: 'http://192.168.1.99:8060/query/active-app' },
    { method: 'POST', url: 'http://192.168.1.99:8060/keypress/InputHDMI1' },
    { method: 'POST', url: 'http://192.168.1.99:8060/launch/837' },
  ]);

  console.log('All Roku ECP unit tests passed!');
}

runTests().catch((err) => {
  console.error('Unit test failure:', err);
  process.exit(1);
});
