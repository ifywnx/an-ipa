/** Reject malformed credentials BEFORE constructing Headers (whose errors echo values). */
export function validBackendSecret(value:string):boolean{
 return /^sb_secret_[A-Za-z0-9_-]{20,200}$/.test(value)||/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}
