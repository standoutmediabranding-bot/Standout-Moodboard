// Makes the key pair that lets Supabase send phone notifications.  Run:  node scripts/make-vapid-keys.js
// The PUBLIC key goes in config.js. The PRIVATE key is a secret: paste it into Supabase (Edge Functions -> Secrets) and never commit it.
const { generateKeyPairSync } = require("crypto");
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
console.log("VAPID_PUBLIC_KEY=" + raw.toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + priv.d);
