const codes=new Set(['WORKER_CONFIG_MISSING','WORKER_DISABLED','WORKER_DATABASE_UNAVAILABLE','WORKER_DATABASE_TRANSPORT_FAILED','DIAGNOSTIC_DISABLED','DIAGNOSTIC_RECEIPT_INVALID','DIAGNOSTIC_UPLOAD_FAILED','DIAGNOSTIC_PUBLIC_OBJECT','DIAGNOSTIC_OVERWRITE_ACCEPTED','DIAGNOSTIC_REJECTION_FAILED','DIAGNOSTIC_CLEANUP_FAILED','DIAGNOSTIC_OBJECT_REMAINS']);
/** Only fixed reviewed error codes cross durable step/log boundaries. */
export function safeWorkerError(error:unknown,fallback:string){
 return error instanceof Error&&codes.has(error.message)?error.message:fallback;
}
