import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Playground } from "app/components/playground";
import { isLang, LANG_BY_ID, LANGUAGES } from "app/lib/languages";

export const dynamicParams = false;
export const generateStaticParams = () => LANGUAGES.map((l) => ({ lang: l.id }));

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const L = LANG_BY_ID[lang];
  return {
    title: `Run ${L.name} in your browser`,
    description: `A ${L.name} playground. ${L.how}, on your device: your code never leaves the browser.`,
    alternates: { canonical: `/${lang}` },
  };
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <Playground lang={lang} />;
}
