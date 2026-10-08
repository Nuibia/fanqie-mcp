export type AbortForLeaseLossOperation = () => void;
export type CallOperation = (name: string, args: unknown) => Promise<unknown>;
export type CloseOwnedOperation = (reason?: 'lease_lost') => Promise<void>;
