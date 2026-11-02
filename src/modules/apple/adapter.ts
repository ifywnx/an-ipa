export interface AppleDevice { id: string; udid: string; enabled: boolean }
export interface AppleAdapter { registerDevice(udid: string, name: string): Promise<AppleDevice> }
export class UnconfiguredAppleAdapter implements AppleAdapter {
 async registerDevice(_udid: string, _name: string): Promise<AppleDevice> {
  throw new Error("APPLE_NOT_CONFIGURED: No device has been registered with Apple");
 }
}
