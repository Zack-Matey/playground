/**
 * The languages: their pages (/python, /go, …), file names, engines and starter examples. Pure data, shared by the
 * pages and the runner worker. Icons are in ./language-icons.tsx so the worker never imports React.
 */
import { ENGINES, type EngineId } from "config/engines";

export type LangId = "python" | "javascript" | "typescript" | "c" | "cpp" | "go" | "rust" | "java";

export type Example = { name: string; code: string; stdin?: string };

export type Language = {
  id: LangId;
  name: string;
  /** Source file name shown on the editor tab. */
  file: string;
  engine: EngineId;
  /** How the code gets run, in a phrase. */
  how: string;
  /** Approximate first-run download (compressed), shown before the first run. */
  download: string;
  /** Brand color, for the icon. */
  color: string;
  /** Marked as experimental in the UI. */
  experimental?: boolean;
  /** Why the program can't read stdin, when it can't (the stdin box is replaced by this note). */
  noStdin?: string;
  examples: Example[];
};

export const LANGUAGES: Language[] = [
  {
    id: "python",
    name: "Python",
    file: "main.py",
    engine: "pyodide",
    how: "CPython 3.14 compiled to WebAssembly (Pyodide)",
    download: "≈ 6 MB",
    color: "#3776AB",
    examples: [
      {
        name: "Hello",
        code: `import sys
import platform

print("Hello from Python", platform.python_version(), "on", sys.platform)

squares = {n: n * n for n in range(1, 6)}
print(squares)
`,
      },
      {
        name: "Primes",
        code: `def primes(limit: int):
    """Sieve of Eratosthenes."""
    sieve = [True] * (limit + 1)
    sieve[0:2] = [False, False]
    for n in range(2, int(limit ** 0.5) + 1):
        if sieve[n]:
            sieve[n * n :: n] = [False] * len(sieve[n * n :: n])
    return [n for n, is_prime in enumerate(sieve) if is_prime]


found = primes(100_000)
print(f"{len(found)} primes below 100,000")
print("largest:", found[-1])
`,
      },
      {
        name: "Read stdin",
        stdin: "Ada\nGrace\nLinus\n",
        code: `import sys

names = [line.strip() for line in sys.stdin if line.strip()]
for i, name in enumerate(sorted(names), 1):
    print(f"{i}. Hello, {name}!")
`,
      },
      {
        name: "Dataclasses",
        code: `from dataclasses import dataclass, field
from collections import Counter


@dataclass(order=True)
class Task:
    priority: int
    title: str = field(compare=False)
    tags: list[str] = field(default_factory=list, compare=False)


tasks = sorted([
    Task(2, "write tests", ["dev"]),
    Task(1, "fix prod", ["ops", "urgent"]),
    Task(3, "lunch", ["life"]),
])
for t in tasks:
    print(t)
print(Counter(tag for t in tasks for tag in t.tags).most_common(2))
`,
      },
    ],
  },
  {
    id: "javascript",
    name: "JavaScript",
    file: "main.js",
    engine: "quickjs",
    how: "QuickJS compiled to WebAssembly, as an ES module",
    download: "≈ 0.5 MB",
    color: "#F7DF1E",
    examples: [
      {
        name: "Hello",
        code: `const greet = (name) => \`Hello, \${name}!\`;
console.log(greet("JavaScript"));

const scores = { ada: 92, grace: 88, linus: 75 };
console.log(scores);
console.table(Object.entries(scores).map(([name, score]) => ({ name, score })));
`,
      },
      {
        name: "Async & timers",
        code: `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.time("total");
for (const step of ["fetching", "parsing", "done"]) {
  await sleep(300);
  console.log(step);
}
console.timeEnd("total");
`,
      },
      {
        name: "Read stdin",
        stdin: "3 4\n5 12\n8 15\n",
        code: `// readline() returns the next line of stdin, or null at the end.
let line;
while ((line = readline()) !== null) {
  const [a, b] = line.split(" ").map(Number);
  console.log(\`hypot(\${a}, \${b}) = \${Math.hypot(a, b)}\`);
}
`,
      },
    ],
  },
  {
    id: "typescript",
    name: "TypeScript",
    file: "main.ts",
    engine: "quickjs",
    how: "Types stripped by Sucrase, then run in QuickJS (WebAssembly)",
    download: "≈ 0.5 MB",
    color: "#3178C6",
    examples: [
      {
        name: "Hello",
        code: `type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius ** 2;
    case "rect":
      return s.width * s.height;
  }
}

const shapes: Shape[] = [
  { kind: "circle", radius: 1 },
  { kind: "rect", width: 3, height: 4 },
];
for (const s of shapes) console.log(s.kind, area(s).toFixed(2));
`,
      },
      {
        name: "Generics",
        code: `class Stack<T> {
  private items: T[] = [];
  push(item: T): this {
    this.items.push(item);
    return this;
  }
  pop(): T | undefined {
    return this.items.pop();
  }
  get size(): number {
    return this.items.length;
  }
}

const s = new Stack<string>().push("a").push("b").push("c");
console.log(s.size, s.pop(), s.size);

const groupBy = <T, K extends PropertyKey>(xs: T[], key: (x: T) => K) =>
  xs.reduce((acc, x) => ((acc[key(x)] ??= []).push(x), acc), {} as Record<K, T[]>);
console.log(groupBy([1, 2, 3, 4, 5, 6], (n) => (n % 2 ? "odd" : "even")));
`,
      },
    ],
  },
  {
    id: "c",
    name: "C",
    file: "main.c",
    engine: "clang",
    how: "Clang 22 compiles to wasm32-wasip1, linked with wasi-libc",
    download: "≈ 20 MB",
    color: "#A8B9CC",
    examples: [
      {
        name: "Hello",
        code: `#include <stdio.h>

int main(void) {
    printf("Hello from C%ld!\\n", __STDC_VERSION__ / 100 % 100);
    for (int i = 1; i <= 5; i++)
        printf("%d squared is %d\\n", i, i * i);
    return 0;
}
`,
      },
      {
        name: "Read stdin",
        stdin: "12 7 3 25 9\n",
        code: `#include <stdio.h>
#include <stdlib.h>

static int cmp(const void *a, const void *b) {
    return *(const int *)a - *(const int *)b;
}

int main(void) {
    int xs[256], n = 0;
    while (n < 256 && scanf("%d", &xs[n]) == 1) n++;
    qsort(xs, n, sizeof *xs, cmp);
    for (int i = 0; i < n; i++) printf("%d ", xs[i]);
    printf("\\n");
    return 0;
}
`,
      },
      {
        name: "Mandelbrot",
        code: `#include <complex.h>
#include <stdio.h>

int main(void) {
    const char *shades = " .:-=+*#%@";
    for (double y = 1.2; y >= -1.2; y -= 0.1) {
        for (double x = -2.1; x <= 0.7; x += 0.04) {
            double complex z = 0, c = x + y * I;
            int i = 0;
            while (cabs(z) < 2 && i < 90) z = z * z + c, i++;
            putchar(shades[i % 10]);
        }
        putchar('\\n');
    }
    return 0;
}
`,
      },
    ],
  },
  {
    id: "cpp",
    name: "C++",
    file: "main.cpp",
    engine: "clang",
    how: "clang++ 22 (C++23, libc++) compiles to wasm32-wasip1",
    download: "≈ 20 MB",
    color: "#00599C",
    examples: [
      {
        name: "Hello",
        code: `#include <algorithm>
#include <iostream>
#include <ranges>
#include <string>
#include <vector>

int main() {
    std::vector<std::string> langs{"rust", "go", "python", "c++"};
    std::ranges::sort(langs);
    for (std::size_t i = 0; const auto& lang : langs | std::views::take(10))
        std::cout << i++ << ": " << lang << "\\n";
    std::cout << "Hello from C++" << __cplusplus / 100 % 100 << "!\\n";
}
`,
      },
      {
        name: "Word count",
        stdin: "the quick brown fox jumps over the lazy dog the end\n",
        code: `#include <iostream>
#include <map>
#include <string>

int main() {
    std::map<std::string, int> counts;
    std::string word;
    while (std::cin >> word) counts[word]++;
    for (const auto& [w, n] : counts)
        std::cout << w << ": " << n << "\\n";
}
`,
      },
    ],
  },
  {
    id: "go",
    name: "Go",
    file: "main.go",
    engine: "go",
    how: `Go's own compiler and linker (${ENGINES.go.version.replace("go", "Go ")}) built for wasip1`,
    download: "≈ 14 MB",
    color: "#00ADD8",
    examples: [
      {
        name: "Hello",
        code: `package main

import (
	"fmt"
	"runtime"
)

func main() {
	fmt.Println("Hello from", runtime.Version(), "on", runtime.GOOS+"/"+runtime.GOARCH)
}
`,
      },
      {
        name: "Goroutines",
        code: `package main

import (
	"fmt"
	"sync"
	"time"
)

func worker(id int, jobs <-chan int, results chan<- string, wg *sync.WaitGroup) {
	defer wg.Done()
	for j := range jobs {
		time.Sleep(50 * time.Millisecond)
		results <- fmt.Sprintf("worker %d finished job %d", id, j)
	}
}

func main() {
	jobs := make(chan int, 10)
	results := make(chan string, 10)
	var wg sync.WaitGroup
	for w := 1; w <= 3; w++ {
		wg.Add(1)
		go worker(w, jobs, results, &wg)
	}
	for j := 1; j <= 6; j++ {
		jobs <- j
	}
	close(jobs)
	wg.Wait()
	close(results)
	for r := range results {
		fmt.Println(r)
	}
}
`,
      },
      {
        name: "Read stdin",
        stdin: "banana\napple\ncherry\n",
        code: `package main

import (
	"bufio"
	"fmt"
	"os"
	"slices"
)

func main() {
	var lines []string
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	slices.Sort(lines)
	for i, l := range lines {
		fmt.Printf("%d. %s\\n", i+1, l)
	}
}
`,
      },
      {
        name: "Generics",
        code: `package main

import "fmt"

type Number interface {
	~int | ~int64 | ~float64
}

func Map[T, U any](xs []T, f func(T) U) []U {
	out := make([]U, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

func Sum[T Number](xs []T) (total T) {
	for _, x := range xs {
		total += x
	}
	return
}

func main() {
	xs := []int{1, 2, 3, 4}
	squares := Map(xs, func(x int) int { return x * x })
	fmt.Println(squares, Sum(squares))
	fmt.Println(Sum([]float64{0.5, 0.25}))
}
`,
      },
    ],
  },
  {
    id: "rust",
    name: "Rust",
    file: "main.rs",
    engine: "rust",
    how: "rustc 1.83 (LLVM) compiled to WebAssembly, linked by wasm-ld",
    download: "≈ 60 MB",
    color: "#DEA584",
    experimental: true,
    examples: [
      {
        name: "Hello",
        code: `fn main() {
    let langs = ["Rust", "WebAssembly", "WASI"];
    println!("Hello from {}!", langs.join(" + "));

    let squares: Vec<u64> = (1..=10).map(|n| n * n).collect();
    println!("{squares:?}");
    println!("sum = {}", squares.iter().sum::<u64>());
}
`,
      },
      {
        name: "Traits",
        code: `use std::fmt;

trait Shape {
    fn area(&self) -> f64;
}

#[derive(Debug)]
struct Circle(f64);
#[derive(Debug)]
struct Rect { w: f64, h: f64 }

impl Shape for Circle {
    fn area(&self) -> f64 { std::f64::consts::PI * self.0 * self.0 }
}
impl Shape for Rect {
    fn area(&self) -> f64 { self.w * self.h }
}

struct Report<'a>(&'a [Box<dyn Shape>]);
impl fmt::Display for Report<'_> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let total: f64 = self.0.iter().map(|s| s.area()).sum();
        write!(f, "{} shapes, total area {total:.2}", self.0.len())
    }
}

fn main() {
    let shapes: Vec<Box<dyn Shape>> = vec![Box::new(Circle(1.0)), Box::new(Rect { w: 3.0, h: 4.0 })];
    println!("{}", Report(&shapes));
}
`,
      },
      {
        name: "Read stdin",
        stdin: "5\n3\n9\n1\n",
        code: `use std::collections::BTreeSet;
use std::io::{self, BufRead};

fn main() {
    let numbers: BTreeSet<i64> = io::stdin()
        .lock()
        .lines()
        .filter_map(|l| l.ok()?.trim().parse().ok())
        .collect();
    println!("sorted: {numbers:?}");
    if let (Some(min), Some(max)) = (numbers.first(), numbers.last()) {
        println!("range: {min}..={max}");
    }
}
`,
      },
    ],
  },
  {
    id: "java",
    name: "Java",
    file: "Main.java",
    engine: "java",
    how: "javac 25 and TeaVM compiled to WebAssembly; your program becomes WebAssembly GC",
    download: "≈ 4 MB",
    color: "#5382A1",
    experimental: true,
    noStdin: "Java programs can't read stdin here: TeaVM's WebAssembly class library has no console input.",
    examples: [
      {
        name: "Hello",
        code: `void main() {
    var langs = List.of("Java", "TeaVM", "WebAssembly");
    IO.println("Hello from " + String.join(" → ", langs) + "!");

    var squares = IntStream.rangeClosed(1, 10).map(n -> n * n).boxed().toList();
    IO.println(squares);
    IO.println("sum = " + squares.stream().mapToInt(Integer::intValue).sum());
}
`,
      },
      {
        name: "Records",
        code: `import java.util.List;

public class Main {
    sealed interface Shape permits Circle, Rect, Square {}
    record Circle(double r) implements Shape {}
    record Rect(double w, double h) implements Shape {}
    record Square(double side) implements Shape {}

    static double area(Shape shape) {
        return switch (shape) {
            case Circle(double r) -> Math.PI * r * r;
            case Rect(double w, double h) -> w * h;
            case Square(double s) -> s * s;
        };
    }

    static String describe(Object o) {
        return switch (o) {
            case Integer i when i > 100 -> "a big int: " + i;
            case Integer i -> "an int: " + i;
            case String s -> "a string of length " + s.length();
            case Shape s -> "a shape, " + s;
            default -> "something else";
        };
    }

    public static void main(String[] args) {
        List<Shape> shapes = List.of(new Circle(1), new Rect(2, 3), new Square(4));
        for (Shape s : shapes) {
            System.out.println(s + " has area " + Math.round(area(s) * 100) / 100.0);
        }
        for (Object o : List.of(7, 1234, "hello", new Square(1), 3.5)) {
            System.out.println(describe(o));
        }
    }
}
`,
      },
      {
        name: "Streams",
        code: `import java.util.*;
import java.util.stream.*;

public class Main {
    record Person(String name, String city, int age) {}

    public static void main(String[] args) {
        var people = List.of(
            new Person("Ada", "London", 36),
            new Person("Grace", "New York", 45),
            new Person("Linus", "Helsinki", 28),
            new Person("Alan", "London", 41),
            new Person("Barbara", "New York", 33));

        Map<String, List<String>> byCity = new TreeMap<>(people.stream()
            .collect(Collectors.groupingBy(Person::city,
                     Collectors.mapping(Person::name, Collectors.toList()))));
        byCity.forEach((city, names) -> System.out.println(city + ": " + names));

        var oldest = people.stream().max(Comparator.comparingInt(Person::age)).orElseThrow();
        System.out.println("oldest: " + oldest.name());

        var stats = people.stream().mapToInt(Person::age).summaryStatistics();
        System.out.println("ages: min " + stats.getMin() + ", max " + stats.getMax() + ", average " + stats.getAverage());

        String text = "the quick brown fox jumps over the lazy dog the end";
        var counts = new TreeMap<String, Integer>();
        for (String word : text.split(" ")) counts.merge(word, 1, (a, b) -> a + b);
        System.out.println(counts);
    }
}
`,
      },
      {
        name: "Threads",
        code: `import java.util.ArrayList;
import java.util.List;

public class Main {
    private static int counter = 0;

    static synchronized void increment() {
        counter++;
    }

    public static void main(String[] args) throws InterruptedException {
        List<Thread> threads = new ArrayList<>();
        for (int i = 1; i <= 3; i++) {
            int id = i;
            Thread t = new Thread(() -> {
                for (int step = 1; step <= 3; step++) {
                    System.out.println("worker " + id + ", step " + step);
                    increment();
                    try {
                        Thread.sleep(100L * id);
                    } catch (InterruptedException e) {
                        return;
                    }
                }
            });
            threads.add(t);
            t.start();
        }
        for (Thread t : threads) t.join();
        System.out.println("all done, counter = " + counter);
    }
}
`,
      },
      {
        name: "Primes",
        code: `import java.util.BitSet;

public class Main {
    static BitSet sieve(int limit) {
        BitSet composite = new BitSet(limit + 1);
        for (int n = 2; (long) n * n <= limit; n++) {
            if (!composite.get(n)) {
                for (int m = n * n; m <= limit; m += n) composite.set(m);
            }
        }
        return composite;
    }

    public static void main(String[] args) {
        int limit = 1_000_000;
        long start = System.currentTimeMillis();
        BitSet composite = sieve(limit);
        int count = 0, largest = 0;
        for (int n = 2; n <= limit; n++) {
            if (!composite.get(n)) {
                count++;
                largest = n;
            }
        }
        System.out.println(count + " primes below " + limit + ", the largest is " + largest);
        System.out.println("took " + (System.currentTimeMillis() - start) + " ms");
    }
}
`,
      },
    ],
  },
];

export const LANG_BY_ID = Object.fromEntries(LANGUAGES.map((l) => [l.id, l])) as Record<LangId, Language>;
export const isLang = (s: string): s is LangId => s in LANG_BY_ID;
