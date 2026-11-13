"use client";

import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Base<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
};

function Mark({ required }: { required?: boolean }) {
  return required ? <span aria-hidden className="text-destructive">*</span> : null;
}

/** A labelled text input wired to the form: label, control, hint and error message, all linked for a11y. */
export function TextField<T extends FieldValues>({ control, name, label, hint, required, className, ...input }: Base<T> & Omit<React.ComponentProps<"input">, "name" | "className">) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label} <Mark required={required} />
          </FormLabel>
          <FormControl>
            <Input {...input} {...field} value={field.value ?? ""} aria-required={required} />
          </FormControl>
          {hint ? <FormDescription>{hint}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({ control, name, label, hint, required, className, ...input }: Base<T> & Omit<React.ComponentProps<"textarea">, "name" | "className">) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label} <Mark required={required} />
          </FormLabel>
          <FormControl>
            <Textarea {...input} {...field} value={field.value ?? ""} />
          </FormControl>
          {hint ? <FormDescription>{hint}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export type Option = { value: string; label: string; disabled?: boolean };

export function SelectField<T extends FieldValues>({ control, name, label, hint, required, className, options, placeholder, ...select }: Base<T> & { options: Option[]; placeholder?: string } & Omit<React.ComponentProps<"select">, "name" | "className">) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label} <Mark required={required} />
          </FormLabel>
          <FormControl>
            <NativeSelect {...select} {...field} value={field.value ?? ""}>
              {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
              {options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </FormControl>
          {hint ? <FormDescription>{hint}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function CheckboxField<T extends FieldValues>({ control, name, label, hint, className }: Base<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn("grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-0.5", className)}>
          <FormControl>
            <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(v === true)} onBlur={field.onBlur} ref={field.ref} className="mt-0.5" />
          </FormControl>
          <FormLabel className="font-normal leading-5">{label}</FormLabel>
          {hint ? <FormDescription className="col-start-2">{hint}</FormDescription> : null}
          <FormMessage className="col-start-2" />
        </FormItem>
      )}
    />
  );
}

/** A two-column grid that collapses to one on small screens. Use `className="sm:col-span-2"` for full width. */
export function FieldGrid({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-4 sm:grid-cols-2", className)} {...props} />;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4">
      <legend className="mb-3 text-sm font-semibold">
        {title}
        {description ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{description}</span> : null}
      </legend>
      {children}
    </fieldset>
  );
}
