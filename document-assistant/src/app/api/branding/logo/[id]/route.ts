import { publicRoute } from "@/server/http";
import { getLogo } from "@/server/services/ui";

/** Logos are shown on the sign-in page, so they're served without sign-in. They contain no client data. */
export const GET = publicRoute<{ id: string }>({ rate: { name: "logo", limit: 300 } }, async ({ db, params }) => {
  const logo = await getLogo(db, params.id);
  return new Response(new Uint8Array(logo.bytes), {
    headers: { "Content-Type": logo.mimeType, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
  });
});
