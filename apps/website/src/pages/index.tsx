import { Footer } from "$lib/components/footer";
import { bindHeroTechCardTracking, HeroTechCards } from "$lib/components/hero-tech-card";
import { Topbar } from "$lib/components/topbar";
import {
  LandingBuildPreview,
  LandingFileTreePreview,
  LandingMdxPreview,
  LandingRealtimePreview,
} from "$lib/landing-previews";
import { Badge, ClipboardText, Icon, LinkButton, LayerCard } from "areia";
import ilha from "ilha";
import { Icon as SocialIcon } from "imprensa/icons";
import { Database, KeyRound, Radio, Server } from "lucide";

export default ilha
  .onMount(({ host }) => bindHeroTechCardTracking(host))
  .render(() => (
    <div class="bg-areia-surface-elevated/50 text-areia-foreground flex min-h-screen flex-col">
      <Topbar />

      <main class="flex-1">
        <section class="container mx-auto mt-20 max-w-6xl px-5 pt-6 pb-12 sm:mt-0 sm:px-6 sm:pt-14 sm:pb-20 md:pt-16 lg:px-8 lg:pt-24 lg:pb-28 xl:pt-28">
          <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 text-center sm:gap-8 lg:gap-10">
            <Badge variant="outline">Own 100% of your backend and your data</Badge>
            <div class="space-y-4 px-0.5 sm:space-y-5 sm:px-0 lg:space-y-6">
              <h1 class="text-[1.75rem] leading-[1.15] font-semibold tracking-tight text-balance sm:text-4xl sm:leading-[1.1] lg:text-5xl lg:leading-[1.08]">
                A batteries-included backend that deploys wherever you already run code.
              </h1>
              <p class="text-areia-subtle mx-auto max-w-2xl px-1 text-[0.9375rem] leading-[1.65] text-balance sm:px-0 sm:text-lg sm:leading-7">
                Outer is an alternative to Supabase, PocketBase, and Firebase, built on Kysely,
                oRPC, and Better Auth. A single builder chain gives you typed schema migrations,
                auto-CRUD resources, auth, and realtime — with no vendor lock-in and no external
                services to provision.
              </p>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-3">
              <LinkButton href="/getting-started" variant="primary" icon={<Icon icon={Database} />}>
                Getting Started
              </LinkButton>
              <LinkButton variant="outline" href="/guide/schema">
                Read the Spec
              </LinkButton>
            </div>
            <ClipboardText
              text="npx giget@latest gh:ilhajs/outer/templates/minimal my-outer-app"
              tooltip
              class="w-full max-w-md px-0.5 text-left sm:px-0"
            />
            <HeroTechCards />
          </div>
        </section>

        <section class="container mx-auto max-w-6xl px-5 pt-4 pb-16 sm:px-6 sm:pt-0 sm:pb-24 lg:px-8">
          <div class="mb-8 max-w-2xl space-y-3 sm:mb-10 sm:space-y-4 md:mb-12">
            <Badge variant="outline">What is included</Badge>
            <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-3xl sm:leading-tight">
              Everything a small backend needs, none of the infra.
            </h2>
            <p class="text-areia-subtle text-[0.9375rem] leading-[1.65] sm:text-base sm:leading-7">
              One fetch-compatible handler. Chain <code>.schema()</code>, <code>.auth()</code>,{" "}
              <code>.middleware()</code>, and <code>.procedure()</code> in order, then{" "}
              <code>.build()</code> and serve it from Node, Hono, H3, or Next.js API routes.
            </p>
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
                  Define tables and relations with <code>schema()</code>, and every{" "}
                  <code>.schema()</code> call becomes a migration step that advances your DB type.
                  Call <code>.resource("post", ...)</code> and get <code>list</code>,{" "}
                  <code>get</code>, <code>create</code>, <code>update</code>, and{" "}
                  <code>delete</code> procedures for free, with clean 409/400/404 error mapping
                  instead of raw 500s.
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
                  <code>.auth()</code> mounts Better Auth at <code>/api/auth/**</code> and accepts
                  every Better Auth option directly. Resource permissions — <code>public</code>,{" "}
                  <code>authenticated</code>, <code>owner</code>, <code>admin</code> — are declared
                  per-procedure, with owner checks and user-id injection handled automatically.
                </p>
                <LandingMdxPreview />
              </LayerCard.Content>
            </LayerCard>

            <LayerCard class="h-full overflow-hidden">
              <LayerCard.Title>
                <span class="flex items-start gap-2.5 text-left leading-snug sm:items-center sm:gap-3">
                  <span class="bg-areia-control flex size-6 shrink-0 items-center justify-center rounded-lg">
                    <Icon icon={Radio} class="size-4" />
                  </span>
                  Realtime without extra infrastructure
                </span>
              </LayerCard.Title>
              <LayerCard.Content class="flex-1 space-y-5 text-[0.9375rem] leading-relaxed sm:text-base sm:leading-7">
                <p class="m-0">
                  Stream updates over SSE with oRPC's event iterators and{" "}
                  <code>EventPublisher</code> — an async generator in a <code>.procedure()</code>{" "}
                  handler is all it takes to fan events out to subscribers, with resumable delivery
                  via <code>withEventMeta</code>.
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
                  <code>pglite()</code> ships a zero-infra embedded Postgres that writes to local
                  disk — perfect for a VPS or Coolify box. Need serverless or edge? Swap in any
                  Kysely <code>Dialect</code> (Neon, D1, Durable Objects) with the same builder
                  chain — <code>templates/cloudflare</code> and <code>templates/vercel-neon</code>{" "}
                  ship with a ready <code>deploy</code> script.
                </p>
                <LandingBuildPreview />
              </LayerCard.Content>
            </LayerCard>
          </div>
        </section>

        <section class="container mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-28 lg:px-8 lg:pb-32">
          <div class="border-areia-border bg-areia-background flex flex-col gap-6 rounded-2xl border p-5 sm:gap-8 sm:p-8 md:flex-row md:items-center md:justify-between lg:p-10">
            <div class="max-w-2xl space-y-2.5 text-left sm:space-y-4">
              <h2 class="text-xl leading-snug font-semibold tracking-tight sm:text-[1.75rem]">
                Your backend, your data, your infrastructure.
              </h2>
              <p class="text-areia-subtle text-[0.9375rem] leading-[1.65] sm:text-base sm:leading-7">
                No hosted control plane, no proprietary APIs, no data leaving your own servers.
                Install the package, write your schema, and ship.
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
