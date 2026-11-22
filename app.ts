import Homey from 'homey';
import { RokuDevice } from './drivers/roku/device';
import { RokuHdmiInput, RokuKey } from './lib/RokuEcpClient';

export class RokuApp extends Homey.App {
  public async onInit(): Promise<void> {
    this.log('RokuApp is initializing...');
    this.registerFlowCards();
    this.log('RokuApp has been initialized');
  }

  private registerFlowCards(): void {
    // Condition: App is running (autocomplete dropdown populated dynamically from GET /query/apps)
    const appIsRunningCondition = this.homey.flow.getConditionCard('app_is_running');
    appIsRunningCondition.registerRunListener(
      async (args: { device: RokuDevice; app: { id: string; name: string } }) => {
        return args.device.isAppRunning(args.app);
      },
    );
    appIsRunningCondition.registerArgumentAutocompleteListener(
      'app',
      async (query: string, args: { device: RokuDevice }) => {
        return args.device.getInstalledApps(query);
      },
    );

    // Action: Launch app (autocomplete dropdown populated dynamically from GET /query/apps)
    const launchAppAction = this.homey.flow.getActionCard('launch_app');
    launchAppAction.registerRunListener(
      async (args: { device: RokuDevice; app: { id: string; name: string } }) => {
        if (!args.app || !args.app.id) {
          throw new Error('No Roku app selected to launch.');
        }
        await args.device.executeLaunchApp(args.app.id);
      },
    );
    launchAppAction.registerArgumentAutocompleteListener(
      'app',
      async (query: string, args: { device: RokuDevice }) => {
        return args.device.getInstalledApps(query);
      },
    );

    // Action: Send remote key (dropdown of all ECP keys)
    const sendRemoteKeyAction = this.homey.flow.getActionCard('send_remote_key');
    sendRemoteKeyAction.registerRunListener(
      async (args: { device: RokuDevice; key: RokuKey }) => {
        if (!args.key) {
          throw new Error('No remote key specified.');
        }
        await args.device.executeKeypress(args.key);
      },
    );

    // Action: Switch HDMI input (for Roku TVs)
    const switchHdmiInputAction = this.homey.flow.getActionCard('switch_hdmi_input');
    switchHdmiInputAction.registerRunListener(
      async (args: { device: RokuDevice; input: RokuHdmiInput }) => {
        if (!args.input) {
          throw new Error('No HDMI input specified.');
        }
        await args.device.executeSwitchHdmiInput(args.input);
      },
    );
  }
}

module.exports = RokuApp;
