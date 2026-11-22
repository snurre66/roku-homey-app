declare module 'homey' {
  namespace Homey {
    export interface DiscoveryResult {
      id: string;
      lastSeen: Date;
    }

    export interface DiscoveryResultSSDP extends DiscoveryResult {
      address: string;
      headers: {
        location?: string;
        usn?: string;
        server?: string;
        [key: string]: string | undefined;
      };
    }

    export interface DiscoveryStrategy {
      getDiscoveryResults(): Record<string, DiscoveryResult>;
    }

    export class FlowCard {
      registerRunListener(listener: (args: any, state?: any) => Promise<any> | any): this;
      registerArgumentAutocompleteListener(
        name: string,
        listener: (query: string, args: any) => Promise<Array<{ id: string; name: string; description?: string }>>,
      ): this;
    }

    export class FlowCardTriggerDevice extends FlowCard {
      trigger(device: Device, tokens?: Record<string, any>, state?: Record<string, any>): Promise<void>;
    }

    export class FlowCardCondition extends FlowCard {}
    export class FlowCardAction extends FlowCard {}

    export interface HomeyInstance {
      __(key: string, tags?: Record<string, string>): string;
      flow: {
        getDeviceTriggerCard(id: string): FlowCardTriggerDevice;
        getConditionCard(id: string): FlowCardCondition;
        getActionCard(id: string): FlowCardAction;
      };
      setInterval(callback: (...args: any[]) => void, ms: number): NodeJS.Timeout;
      clearInterval(timeoutId: NodeJS.Timeout): void;
      setTimeout(callback: (...args: any[]) => void, ms: number): NodeJS.Timeout;
      clearTimeout(timeoutId: NodeJS.Timeout): void;
    }

    export class SimpleClass {
      homey: HomeyInstance;
      log(...args: any[]): void;
      error(...args: any[]): void;
    }

    export class App extends SimpleClass {
      onInit(): Promise<void>;
    }

    export namespace Driver {
      export interface PairSession {
        setHandler(event: string, handler: (data?: any) => Promise<any> | any): void;
        showView(viewId: string): Promise<void>;
        nextView(): Promise<void>;
        done(): Promise<void>;
      }
    }

    export class Driver extends SimpleClass {
      onInit(): Promise<void>;
      onPair(session: Driver.PairSession): Promise<void>;
      getDiscoveryStrategy(): DiscoveryStrategy;
    }

    export class Device extends SimpleClass {
      onInit(): Promise<void>;
      onUninit(): Promise<void>;
      getName(): string;
      getData(): { id: string; [key: string]: any };
      getSettings(): Record<string, any>;
      getSetting(key: string): any;
      setSettings(settings: Record<string, any>): Promise<void>;
      getStore(): Record<string, any>;
      getStoreValue(key: string): any;
      setStoreValue(key: string, value: any): Promise<void>;
      hasCapability(capability: string): boolean;
      addCapability(capability: string): Promise<void>;
      removeCapability(capability: string): Promise<void>;
      getCapabilityValue(capability: string): any;
      setCapabilityValue(capability: string, value: any): Promise<void>;
      registerCapabilityListener(
        capability: string,
        listener: (value: any, opts?: any) => Promise<void>,
      ): void;
      getAvailable(): boolean;
      setAvailable(): Promise<void>;
      setUnavailable(message?: string | null): Promise<void>;
      setWarning(message: string | null): Promise<void>;
      unsetWarning(): Promise<void>;
      onSettings(event: {
        oldSettings: Record<string, any>;
        newSettings: Record<string, any>;
        changedKeys: string[];
      }): Promise<string | void>;
      onDiscoveryResult(discoveryResult: DiscoveryResult): boolean;
      onDiscoveryAvailable(discoveryResult: DiscoveryResult): Promise<void>;
      onDiscoveryAddressChanged(discoveryResult: DiscoveryResult): void;
    }
  }

  export = Homey;
}
