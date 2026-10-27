/** Prints a new random encryption key for STORAGE_ENCRYPTION_KEY (store it in Azure Key Vault). */
import crypto from "node:crypto";

console.log(crypto.randomBytes(32).toString("base64"));
