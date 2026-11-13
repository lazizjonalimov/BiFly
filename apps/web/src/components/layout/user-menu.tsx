"use client";

import { KeyRoundIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { PasswordDialog } from "@/components/layout/password-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLocalPreference } from "@/hooks/use-local-preference";
import { postJson } from "@/lib/api/post";
import { useSession } from "@/lib/auth/session";
import { humanize, initials } from "@/lib/format/text";
import { hardNavigate } from "@/lib/hard-navigation";

type Theme = "light" | "dark" | "system";
const THEMES: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "Match my device", icon: MonitorIcon },
];

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function UserMenu() {
  const { user, organization } = useSession();
  const [theme, setTheme] = useLocalPreference("bifly-theme", "system");
  const [passwordOpen, setPasswordOpen] = useState(false);

  function chooseTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  async function signOut() {
    await postJson("/api/auth/logout", {}).catch(() => undefined);
    hardNavigate("/login");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary transition-colors hover:bg-primary/20" aria-label={`Account menu for ${user.full_name}`}>
          {initials(user.full_name)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">{user.full_name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {humanize(organization.role)} at {organization.name}
            </p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          {THEMES.map((option) => (
            <DropdownMenuItem key={option.value} onSelect={() => chooseTheme(option.value)} aria-checked={theme === option.value} role="menuitemradio">
              <option.icon /> {option.label}
              {theme === option.value ? <span className="ml-auto text-xs text-primary">On</span> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
            <KeyRoundIcon /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={signOut}>
            <LogOutIcon /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}
