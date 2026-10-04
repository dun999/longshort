export * from '@longshort/shared/gate';
import { gateConfig } from '@longshort/shared/gate';

export const privateMode = () => !gateConfig().bypass;
