import type { MetadataRoute } from "next";
import { SITE } from "./lib/site";
import { LANGUAGES } from "./lib/languages";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE.url, changeFrequency: "monthly", priority: 1 },
    ...LANGUAGES.map((l) => ({ url: `${SITE.url}/${l.id}`, changeFrequency: "monthly" as const, priority: 0.9 })),
    { url: `${SITE.url}/about`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
