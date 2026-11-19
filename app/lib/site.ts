export const SITE = {
  name: "Playground",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://playground.zackmatey.com").replace(/\/$/, ""),
  description: "Run Python, JavaScript, TypeScript, C, C++, Go, Rust and Java in your browser. Every compiler and interpreter runs as WebAssembly on your device, so your code never leaves it.",
  github: "https://github.com/Zack-Matey",
};

export const WIDE = "w-full max-w-7xl px-4 md:px-8";
