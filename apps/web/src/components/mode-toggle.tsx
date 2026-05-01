"use client";

import { Button } from "@test-evals/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@test-evals/ui/components/dropdown-menu";
import { Moon, Sun } from "lucide-react";

type ThemeChoice = "light" | "dark" | "system";

function applyTheme(choice: ThemeChoice) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const isSystemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shouldUseDark = choice === "dark" || (choice === "system" && isSystemDark);

  root.classList.toggle("dark", shouldUseDark);
  localStorage.setItem("theme", choice);
}

export function ModeToggle() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
        <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => applyTheme("light")}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => applyTheme("dark")}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => applyTheme("system")}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
