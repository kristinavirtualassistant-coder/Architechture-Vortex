/**
 * Vortex One Dialer - Telephony Provider Registry
 */

import { ITelephonyProvider } from '../types/dialer.js';
import { MockTelephonyProvider } from './MockTelephonyProvider.js';
import { RingCentralProvider } from './RingCentralProvider.js';

export class ProviderRegistry {
  private providers: Map<string, ITelephonyProvider> = new Map();
  private defaultProviderName: string = process.env.DEFAULT_TELEPHONY_PROVIDER || 'mock';

  constructor() {
    const mockProvider = new MockTelephonyProvider();
    const ringCentralProvider = new RingCentralProvider();

    this.registerProvider(mockProvider);
    this.registerProvider(ringCentralProvider);
  }

  public registerProvider(provider: ITelephonyProvider): void {
    this.providers.set(provider.providerName, provider);
  }

  public getProvider(name?: string): ITelephonyProvider {
    const target = name || this.defaultProviderName;
    const provider = this.providers.get(target);
    if (!provider) {
      // Fallback to mock
      return this.providers.get('mock')!;
    }
    return provider;
  }

  public setDefaultProvider(name: string): boolean {
    if (this.providers.has(name)) {
      this.defaultProviderName = name;
      return true;
    }
    return false;
  }

  public getMockProvider(): MockTelephonyProvider {
    return this.providers.get('mock') as MockTelephonyProvider;
  }

  public getRingCentralProvider(): RingCentralProvider {
    return this.providers.get('ringcentral') as RingCentralProvider;
  }

  public listProviders(): Array<{ name: string; isDefault: boolean; isConfigured: boolean }> {
    return Array.from(this.providers.entries()).map(([name, provider]) => {
      let isConfigured = true;
      if (name === 'ringcentral') {
        isConfigured = (provider as RingCentralProvider).isConfigured();
      }
      return {
        name,
        isDefault: name === this.defaultProviderName,
        isConfigured,
      };
    });
  }
}

export const providerRegistry = new ProviderRegistry();
