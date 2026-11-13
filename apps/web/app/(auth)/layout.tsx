export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">TMS</span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">BiFly</span>
        </div>
        {children}
      </div>
    </main>
  );
}
