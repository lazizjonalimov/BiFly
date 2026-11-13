"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedInput } from "@/hooks/use-debounced";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string; hint?: string };

type Props = {
  /** The chosen record's id, or "" for none. */
  value: string;
  /** Its name, shown while closed. The picker never needs to have loaded the record to show it. */
  selectedLabel?: string;
  onChange: (option: ComboOption | null) => void;
  /** Ask the API. Called as the user types; results are whatever the server says matches. */
  search: (query: string, signal: AbortSignal) => Promise<ComboOption[]>;
  /** Identifies this picker's results in the cache, e.g. [orgId, "customers", "picker"]. */
  queryKey: unknown[];
  placeholder: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
};

/**
 * A picker for lists too long to put in a dropdown (customers, drivers). It searches on the server as you
 * type instead of downloading every record, and works with the keyboard alone.
 */
export function AsyncCombobox({ value, selectedLabel, onChange, search, queryKey, placeholder, emptyText = "Nothing found", disabled, ...aria }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useDebouncedInput(query, setQuery, 200);
  const results = useQuery({ queryKey: [...queryKey, query], queryFn: ({ signal }) => search(query, signal), enabled: open, staleTime: 30_000 });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
          !value && "text-muted-foreground",
        )}
        {...aria}
      >
        <span className="truncate">{value ? (selectedLabel ?? "Selected") : placeholder}</span>
        <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        {/* Filtering is the server's job, so cmdk's own filtering is turned off. */}
        <Command shouldFilter={false}>
          <CommandInput value={typed} onValueChange={setTyped} placeholder="Type to search" />
          <CommandList>
            {results.isPending ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" /> Searching
              </div>
            ) : results.isError ? (
              <p className="py-6 text-center text-sm text-destructive">Couldn&apos;t search. Try again.</p>
            ) : (
              <>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {results.data.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => {
                        onChange(option.value === value ? null : option);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{option.label}</span>
                        {option.hint ? <span className="block truncate text-xs text-muted-foreground">{option.hint}</span> : null}
                      </span>
                      {option.value === value ? <CheckIcon className="!text-primary" /> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
