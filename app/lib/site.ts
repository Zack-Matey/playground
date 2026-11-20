export const SITE = {
  name: "Playground",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://playground.zackmatey.com").replace(/\/$/, ""),
  description: "Run Python, JavaScript, TypeScript, C, C++, Go, Rust and Java in your browser. Every compiler and interpreter runs as WebAssembly on your device, so your code never leaves it.",
  github: "https://github.com/Zack-Matey",
  /** The site's source (AGPL-3.0: visitors must be offered it). */
  source: "https://github.com/Zack-Matey/playground",
};

export const WIDE = "w-full max-w-7xl px-4 md:px-8";
