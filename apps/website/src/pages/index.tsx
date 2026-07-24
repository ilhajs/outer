import { Footer } from "$lib/components/footer";
import { bindHeroTechCardTracking, HeroTechCards } from "$lib/components/hero-tech-card";
import { Topbar } from "$lib/components/topbar";
import {
  LandingBuildPreview,
  LandingClientPreview,
  LandingFilesPreview,
  LandingFileTreePreview,
  LandingHeroPreview,
  LandingMdxPreview,
  LandingRealtimePreview,
} from "$lib/landing-previews";
import { Badge, ClipboardText, Icon, LinkButton, LayerCard, Radio } from "areia";
import ilha from "ilha";
import { Icon as SocialIcon } from "imprensa/icons";
import {
  Bot,
  CircleCheck,
  CircleX,
  CloudUpload,
  Database,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Lock,
  Radio as RadioIcon,
  Route,
  Server,
  ShieldCheck,
  Sparkles,
  Upload,
  Zap,
} from "lucide";

const cloudLogos: { src: string; alt: string; class?: string }[] = [
  { src: "/logo/cloudflare-svgrepo-com.svg", alt: "Cloudflare" },
  { src: "/logo/vercel-svgrepo-com.svg", alt: "Vercel", class: "scale-150" },
  { src: "/logo/aws-svgrepo-com.svg", alt: "AWS" },
  { src: "/logo/google-cloud-svgrepo-com.svg", alt: "Google Cloud" },
  { src: "/logo/azure-svgrepo-com.svg", alt: "Azure" },
];

const differentiators: { icon: typeof Lock; title: string; description: string }[] = [
  {
    icon: Sparkles,
    title: "pgvector, out of the box",
    description:
      "PGlite is real embedded Postgres with pgvector bundled in. Vector search on a $4 VPS — no managed tier, no add-on to switch on.",
  },
  {
    icon: Route,
    title: "One router. Four surfaces.",
    description:
      "Define a procedure once and it's served as typed RPC, REST, an OpenAPI spec, and an MCP tool. No second definition to keep in sync.",
  },
  {
    icon: Bot,
    title: "Your API, your agent's toolbox",
    description:
      "`.mcp()` hands agents your shipped business logic — not raw database access — inheriting the exact permissions your app already enforces.",
  },
  {
    icon: Zap,
    title: "Schema to SSR, no HTTP hop",
    description:
      "`outer.client()` calls procedures in-process during server rendering. Same types, no serialization, no localhost round-trip.",
  },
];

const uploadTraits: { icon: typeof Lock; title: string; description: string }[] = [
  {
    icon: Lock,
    title: "Private by default",
    description: "Only the uploader reads a file. Everyone else gets a 404, never a 403.",
  },
  {
    icon: HardDrive,
    title: "Bytes stay yours",
    description: "Local disk on a VPS, R2, S3, or Vercel Blob — the database holds only metadata.",
  },
  {
    icon: CloudUpload,
    title: "Typed, like the rest",
    description: "Pass a File to the SDK and the request becomes multipart on its own.",
  },
];

const compareRows: { pain: string; relief: string }[] = [
  {
    pain: "Your data lives in someone else's database, behind their dashboard and their billing.",
    relief: "Your data lives in your Postgres, on your infra. `.outer/pglite` is a folder you own.",
  },
  {
    pain: "Auth is a black box you configure through a settings UI.",
    relief:
      "Auth is Better Auth — real code you can read, extend, and call directly from `context.auth`.",
  },
  {
    pain: "REST/GraphQL client code is generated after the fact and quietly drifts from your schema.",
    relief: "The client type is inferred straight from your server. If it compiles, it matches.",
  },
  {
    pain: "Scaling past the free tier means picking a new pricing plan.",
    relief: "Scaling means giving the box you already pay for more CPU and RAM.",
  },
];

export default ilha
  .state("template", "minimal")
  .derived(
    "cloneCommand",
    ({ state }) => `npx giget@latest gh:ilhajs/outer/templates/${state.template()}`,
  )
  .onMount(({ host }) => bindHeroTechCardTracking(host))
  .render(({ state, derived }) => (
    <div class="bg-areia-surface-elevated/50 text-areia-foreground flex min-h-screen flex-col">
      <Topbar />

      <main class="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section class="container mx-auto max-w-6xl px-5 pt-14 pb-12 sm:px-6 sm:pt-20 sm:pb-16 lg:px-8 lg:pt-24">
          <div class="grid items-center gap-10 md:grid-cols-2 md:gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
            <div class="flex min-w-0 flex-col items-start gap-5 text-left sm:gap-6">
              <Badge variant="outline">Self-hosted · MIT licensed · Alpha</Badge>
              <h1 class="text-[1.9rem] leading-[1.12] font-semibold tracking-tight text-balance sm:text-4xl sm:leading-[1.1] lg:text-[2.75rem] lg:leading-[1.08]">
                The open-source backend for the agentic internet.
              </h1>
              <p class="text-areia-subtle max-w-xl text-[0.9375rem] leading-[1.65] text-balance sm:text-lg sm:leading-7">
                Define a procedure once and serve it as typed RPC, REST, OpenAPI, and an MCP tool
                your agents can call. Real Postgres with pgvector, running on the same box as your
                app — no managed cloud to rent.
              </p>
              <div class="flex w-full max-w-md flex-row gap-2 px-0.5 sm:gap-3 sm:px-0">
                <LinkButton
                  href="/getting-started"
                  variant="primary"
                  icon={<Icon icon={Database} class="size-4 shrink-0" />}
                  class="flex-1 justify-center px-2 text-sm whitespace-nowrap sm:px-3 sm:text-base"
                >
                  Get started
                </LinkButton>
                <LinkButton
                  variant="outline"
                  href="https://github.com/ilhajs/outer"
                  icon={<SocialIcon icon="github" class="size-4 shrink-0" />}
                  external
                  class="flex-1 justify-center px-2 text-sm whitespace-nowrap sm:px-3 sm:text-base"
                >
                  GitHub
                </LinkButton>
              </div>
              <div class="flex w-full flex-col gap-2">
                <Radio.Group legend="Template" name="template" orientation="horizontal">
                  <Radio.Item
                    label="Minimal"
                    value="minimal"
                    bind:group={state.template}
                    name="template"
                    checked
                  />
                  <Radio.Item
                    label="Ilha"
                    value="ilha"
                    bind:group={state.template}
                    name="template"
                  />
                  <Radio.Item
                    label="Cloudflare"
                    value="cloudflare"
                    bind:group={state.template}
                    name="template"
                  />
                  <Radio.Item
                    label="Vercel"
                    value="vercel"
                    bind:group={state.template}
                    name="template"
                  />
                </Radio.Group>
                <ClipboardText
                  text={derived.cloneCommand()}
                  tooltip
                  class="w-full max-w-lg px-0.5 text-left sm:px-0"
                />
              </div>
            </div>

            <div data-hero-snippet class="min-w-0">
              <LandingHeroPreview />
            </div>
          </div>

          <div class="mt-2">
            <p class="text-areia-subtle pt-8 text-center text-xs tracking-wide uppercase sm:pt-10">
              Built entirely on tools you already trust
            </p>
            <HeroTechCards />
            <p class="text-areia-subtle mt-10 text-center text-xs tracking-wide uppercase sm:mt-12">
              Deploys to
            </p>
            <div class="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-5 sm:gap-x-12">
              {cloudLogos.map((logo) => (
                <img
                  src={logo.src}
                  alt={logo.alt}
                  loading="lazy"
                  class={`h-9 w-auto opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0 sm:h-11 dark:invert ${logo.class ?? ""}`}
                />
              ))}
            </div>
          </div>
        </section>

        {/* ── Differentiators band ────────────────────────────────────────── */}
        <section class="container mx-auto max-w-6xl px-5 pt-4 pb-16 sm:px-6 sm:pt-6 sm:pb-24 lg:px-8">
          <div class="mb-8 max-w-2xl space-y-3 sm:mb-10 sm:space-y-4">
            <Badge variant="outline">Never choose between zero-infra and full-power</Badge>
            <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-3xl sm:leading-tight">
              Full-power Postgres and an agent-ready API, with nothing to run but your app.
            </h2>
          </div>
          <div class="grid gap-5 sm:grid-cols-2 sm:gap-6">
            {differentiators.map((item) => (
              <div class="border-areia-border bg-areia-background flex items-start gap-4 rounded-2xl border p-5 sm:p-6">
                <span class="bg-areia-control flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <Icon icon={item.icon} class="size-5" />
                </span>
                <div class="min-w-0 space-y-1.5">
                  <h3 class="text-base leading-snug font-semibold tracking-tight sm:text-lg">
                    {item.title}
                  </h3>
                  <p class="text-areia-subtle text-[0.9375rem] leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Contrast: hosted BaaS vs. Outer ─────────────────────────────── */}
        <section class="container mx-auto max-w-6xl px-5 pt-4 pb-16 sm:px-6 sm:pt-6 sm:pb-24 lg:px-8">
          <div class="mb-8 max-w-2xl space-y-3 sm:mb-10 sm:space-y-4">
            <Badge variant="outline">Why leave a hosted BaaS</Badge>
            <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-3xl sm:leading-tight">
              You already have a server. You don't need to rent a second backend on top of it.
            </h2>
          </div>
          <div class="border-areia-border bg-areia-background divide-areia-border divide-y overflow-hidden rounded-2xl border">
            {compareRows.map((row) => (
              <div class="grid gap-3 p-4 sm:grid-cols-2 sm:gap-6 sm:p-5">
                <div class="flex items-start gap-2.5">
                  <Icon icon={CircleX} class="text-areia-destructive mt-0.5 size-4 shrink-0" />
                  <p class="text-areia-subtle text-[0.9375rem] leading-relaxed sm:text-base">
                    {row.pain}
                  </p>
                </div>
                <div class="flex items-start gap-2.5">
                  <Icon icon={CircleCheck} class="text-areia-success mt-0.5 size-4 shrink-0" />
                  <p class="text-[0.9375rem] leading-relaxed sm:text-base">{row.relief}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Feature grid ─────────────────────────────────────────────── */}
        <section class="container mx-auto max-w-6xl px-5 pt-4 pb-16 sm:px-6 sm:pt-0 sm:pb-24 lg:px-8">
          <div class="mb-8 max-w-2xl space-y-3 sm:mb-10 sm:space-y-4 md:mb-12">
            <Badge variant="outline">What's in the box</Badge>
            <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-3xl sm:leading-tight">
              Everything a small backend needs, none of the infra.
            </h2>
          </div>
          <div class="grid gap-5 sm:gap-6 md:grid-cols-2 md:gap-7">
            <LayerCard class="h-full overflow-hidden">
              <LayerCard.Title>
                <span class="flex items-start gap-2.5 text-left leading-snug sm:items-center sm:gap-3">
                  <span class="bg-areia-control flex size-6 shrink-0 items-center justify-center rounded-lg">
                    <Icon icon={Database} class="size-4" />
                  </span>
                  Typed schema, auto-generated CRUD
                </span>
              </LayerCard.Title>
              <LayerCard.Content class="flex-1 space-y-5 text-[0.9375rem] leading-relaxed sm:text-base sm:leading-7">
                <p class="m-0">
                  One <code>.resource()</code> call turns a table into <code>list</code>,{" "}
                  <code>get</code>, <code>create</code>, <code>update</code>, <code>delete</code> —
                  with clean 409/400/404 errors instead of raw 500s.
                </p>
                <LandingFileTreePreview />
              </LayerCard.Content>
            </LayerCard>

            <LayerCard class="h-full overflow-hidden">
              <LayerCard.Title>
                <span class="flex items-start gap-2.5 text-left leading-snug sm:items-center sm:gap-3">
                  <span class="bg-areia-control flex size-6 shrink-0 items-center justify-center rounded-lg">
                    <Icon icon={KeyRound} class="size-4" />
                  </span>
                  Auth and permissions, built in
                </span>
              </LayerCard.Title>
              <LayerCard.Content class="flex-1 space-y-5 text-[0.9375rem] leading-relaxed sm:text-base sm:leading-7">
                <p class="m-0">
                  <code>.auth()</code> mounts Better Auth directly. Declare <code>public</code>,{" "}
                  <code>authenticated</code>, <code>owner</code>, or <code>admin</code> per
                  procedure — ownership checks happen automatically.
                </p>
                <LandingMdxPreview />
              </LayerCard.Content>
            </LayerCard>

            <LayerCard class="h-full overflow-hidden">
              <LayerCard.Title>
                <span class="flex items-start gap-2.5 text-left leading-snug sm:items-center sm:gap-3">
                  <span class="bg-areia-control flex size-6 shrink-0 items-center justify-center rounded-lg">
                    <Icon icon={RadioIcon} class="size-4" />
                  </span>
                  Realtime without extra infrastructure
                </span>
              </LayerCard.Title>
              <LayerCard.Content class="flex-1 space-y-5 text-[0.9375rem] leading-relaxed sm:text-base sm:leading-7">
                <p class="m-0">
                  An async generator in a <code>.procedure()</code> handler is all it takes to
                  stream updates over SSE, with resumable delivery via <code>withEventMeta</code> —
                  no message broker to run.
                </p>
                <LandingRealtimePreview />
              </LayerCard.Content>
            </LayerCard>

            <LayerCard class="h-full overflow-hidden">
              <LayerCard.Title>
                <span class="flex items-start gap-2.5 text-left leading-snug sm:items-center sm:gap-3">
                  <span class="bg-areia-control flex size-6 shrink-0 items-center justify-center rounded-lg">
                    <Icon icon={Server} class="size-4" />
                  </span>
                  Deploy to a VPS, or go serverless
                </span>
              </LayerCard.Title>
              <LayerCard.Content class="flex-1 space-y-5 text-[0.9375rem] leading-relaxed sm:text-base sm:leading-7">
                <p class="m-0">
                  <code>pglite()</code> ships a zero-infra embedded Postgres for a VPS or Coolify
                  box. Need serverless instead? Swap in any Kysely <code>Dialect</code> with the
                  same builder chain.
                </p>
                <LandingBuildPreview />
              </LayerCard.Content>
            </LayerCard>

            <LayerCard class="h-full overflow-hidden md:col-span-2">
              <LayerCard.Title>
                <span class="flex items-start gap-2.5 text-left leading-snug sm:items-center sm:gap-3">
                  <span class="bg-areia-control flex size-6 shrink-0 items-center justify-center rounded-lg">
                    <Icon icon={Upload} class="size-4" />
                  </span>
                  File uploads, without a second service
                </span>
              </LayerCard.Title>
              <LayerCard.Content class="flex-1 text-[0.9375rem] leading-relaxed sm:text-base sm:leading-7">
                <div class="grid gap-6 md:grid-cols-2 md:items-center md:gap-8">
                  <div class="space-y-5">
                    <p class="m-0">
                      <code>.files()</code> mounts upload, download, listing, and attachments over
                      the storage you already have — no signed-URL dance, no bucket SDK leaking into
                      your handlers.
                    </p>
                    <ul class="m-0 grid list-none gap-3.5 p-0">
                      {uploadTraits.map((trait) => (
                        <li class="flex items-start gap-3">
                          <span class="bg-areia-control mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg">
                            <Icon icon={trait.icon} class="size-3.5" />
                          </span>
                          <span class="min-w-0">
                            <span class="text-areia-foreground block text-sm leading-snug font-medium">
                              {trait.title}
                            </span>
                            <span class="text-areia-subtle block text-sm leading-relaxed">
                              {trait.description}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div class="min-w-0">
                    <LandingFilesPreview />
                  </div>
                </div>
              </LayerCard.Content>
            </LayerCard>
          </div>
        </section>

        {/* ── Outer Hub callout ────────────────────────────────────────── */}
        <section class="container mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-24 lg:px-8">
          <div class="border-areia-border bg-areia-background flex flex-col gap-6 rounded-2xl border p-5 sm:p-8 md:flex-row md:items-center md:justify-between lg:p-10">
            <div class="max-w-2xl space-y-3 sm:space-y-4">
              <span class="bg-areia-control flex size-9 items-center justify-center rounded-lg">
                <Icon icon={LayoutDashboard} class="size-5" />
              </span>
              <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">
                Outer Hub: the dashboard, without the hosted lock-in.
              </h2>
              <p class="text-areia-subtle text-[0.9375rem] leading-[1.65] sm:text-base sm:leading-7">
                Browse and edit tables, manage files and API tokens, and explore your API — for any
                instance, from your browser. Hub is a static app: your instance URL lives in
                localStorage and every request goes straight to your server, never through ours.
              </p>
            </div>
            <div class="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
              <LinkButton
                href="https://hub.outer.now"
                external
                variant="primary"
                class="w-full sm:w-auto"
              >
                Open Outer Hub
              </LinkButton>
              <LinkButton href="/guide/hub" variant="outline" class="w-full sm:w-auto">
                Read the guide
              </LinkButton>
            </div>
          </div>
        </section>

        {/* ── Type-safety callout ──────────────────────────────────────── */}
        <section class="container mx-auto max-w-6xl px-5 pb-16 sm:px-6 sm:pb-24 lg:px-8">
          <div class="border-areia-border bg-areia-background grid gap-8 rounded-2xl border p-5 sm:p-8 md:grid-cols-2 md:items-center lg:p-10">
            <div class="space-y-3 sm:space-y-4">
              <span class="bg-areia-control flex size-9 items-center justify-center rounded-lg">
                <Icon icon={ShieldCheck} class="size-5" />
              </span>
              <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-2xl">
                No codegen step. No client SDK to regenerate. Just types.
              </h2>
              <p class="text-areia-subtle text-[0.9375rem] leading-[1.65] sm:text-base sm:leading-7">
                <code>InferRouter&lt;typeof server&gt;</code> hands your server's exact procedure
                types to <code>@outerjs/sdk</code>. Rename a field on the server and every caller
                turns red before you ship — not after a customer reports it.
              </p>
            </div>
            <LandingClientPreview />
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────── */}
        <section class="container mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-28 lg:px-8 lg:pb-32">
          <div class="border-areia-border bg-areia-background flex flex-col gap-6 rounded-2xl border p-5 sm:gap-8 sm:p-8 md:flex-row md:items-center md:justify-between lg:p-10">
            <div class="max-w-2xl space-y-2.5 text-left sm:space-y-4">
              <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-[1.75rem]">
                Install it, write your schema, ship.
              </h2>
              <p class="text-areia-subtle text-[0.9375rem] leading-[1.65] sm:text-base sm:leading-7">
                Schema, auth, permissions, files, realtime, a four-surface API, and the Outer Hub
                dashboard are in the box today. Typed vector columns are next. MIT licensed, no
                telemetry, nothing phoning home — the whole thing runs on hardware you already pay
                for.
              </p>
            </div>
            <div class="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:gap-3">
              <LinkButton href="/getting-started" variant="primary" class="w-full sm:w-auto">
                Start building
              </LinkButton>
              <LinkButton
                variant="outline"
                href="https://github.com/ilhajs/outer"
                icon={<SocialIcon icon="github" class="size-6 shrink-0" />}
                external
                class="w-full sm:w-auto"
              >
                GitHub
              </LinkButton>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  ));
