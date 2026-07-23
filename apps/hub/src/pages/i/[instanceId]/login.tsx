import { getClient } from "$lib/outer";
import { getInstanceById } from "$lib/store";
import { invalidate, loader, navigate, type InferLoader } from "@ilha/router";
import { extractFormData, validateWithSchema } from "@ilha/store/form";
import { Button, Icon, Input, LayerCard, LinkButton } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { RefreshCw, Unplug } from "lucide";
import { when } from "quando";
import { z } from "zod";

export const clientLoad = loader(async ({ head, params }) => {
  head({ title: "Sign In" });
  const { instanceId } = params;
  const instance = getInstanceById(instanceId);
  if (!instance) {
    navigate(`/i`);
    return {};
  }
  try {
    const client = getClient(instance.url);
    const authSession = await client.auth.getSession();
    if (authSession.data) {
      navigate(`/i/${instanceId}`);
      return {};
    }
  } catch (error) {
    return {
      instance,
      connectionError: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    instance,
  };
});

const FORM_STEP = {
  REQUEST_OTP: "REQUEST_OTP",
  VERIFY_OTP: "VERIFY_OTP",
} as const;

const LoginSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal(FORM_STEP.REQUEST_OTP),
    email: z.email("Enter a valid email address"),
  }),
  z.object({
    step: z.literal(FORM_STEP.VERIFY_OTP),
    email: z.email(),
    otp: z.string().trim().min(1, "Enter the verification code"),
  }),
]);

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .state("step", FORM_STEP.REQUEST_OTP as keyof typeof FORM_STEP)
  .state("email", "")
  .state("busy", false)
  .on("[data-retry-connection]@click", () => invalidate())
  .on("[data-change-email]@click", ({ state }) => state.step(FORM_STEP.REQUEST_OTP))
  .on("[data-resend-otp]@click", async ({ input, state }) => {
    if (state.busy()) return;
    state.busy(true);
    try {
      const client = getClient(input.instance!.url);
      const { error } = await client.auth.emailOtp.sendVerificationOtp({
        email: state.email(),
        type: "sign-in",
      });
      if (error) return void toast.error(error.message);
      toast.success(`New code sent to ${state.email()}`);
    } finally {
      state.busy(false);
    }
  })
  .on("#login-form@submit", async ({ input, state, event }) => {
    event.preventDefault();
    if (state.busy()) return;
    const client = getClient(input.instance!.url);
    const formData = extractFormData(event.target as HTMLFormElement);
    const result = validateWithSchema(LoginSchema, formData);
    if (!result.ok) {
      return void toast.error(result.issues[0].message);
    }
    state.busy(true);
    try {
      if (result.data.step === FORM_STEP.REQUEST_OTP) {
        const { error } = await client.auth.emailOtp.sendVerificationOtp({
          email: result.data.email,
          type: "sign-in",
        });
        if (error) {
          return void toast.error(error.message);
        }
        state.email(result.data.email);
        toast.success(`Code sent to ${result.data.email}`);
        return state.step(FORM_STEP.VERIFY_OTP);
      }
      const { error } = await client.auth.signIn.emailOtp({
        email: result.data.email,
        otp: result.data.otp,
      });
      if (error) {
        return void toast.error(error.message);
      }
      return navigate(`/i/${input.instance!.id}`);
    } finally {
      state.busy(false);
    }
  })
  .render(({ input, state }) => {
    if (input.connectionError) {
      return (
        <div class="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
          <LayerCard class="max-w-lg">
            <LayerCard.Title class="flex items-center gap-2">
              <Icon icon={Unplug} class="text-areia-danger size-5" />
              <span>Can't reach {input.instance?.name}</span>
            </LayerCard.Title>
            <LayerCard.Content class="flex flex-col gap-4">
              <p class="text-muted-foreground text-sm">
                The instance at <code class="font-mono">{input.instance?.url}</code> did not
                respond, so you can't sign in right now.
              </p>
              <div class="flex items-center justify-end gap-2">
                <LinkButton href="/i" variant="ghost">
                  All Instances
                </LinkButton>
                <Button
                  type="button"
                  data-retry-connection
                  variant="primary"
                  icon={<Icon icon={RefreshCw} />}
                >
                  Retry
                </Button>
              </div>
            </LayerCard.Content>
          </LayerCard>
        </div>
      );
    }

    const verifying = state.step() === FORM_STEP.VERIFY_OTP;

    return (
      <div class="flex min-h-screen flex-col items-center justify-center gap-4">
        <LayerCard class="w-full max-w-lg">
          <LayerCard.Title>Sign In To {input.instance?.name}</LayerCard.Title>
          <LayerCard.Content>
            <form id="login-form" class="flex flex-col gap-3">
              <input type="hidden" name="step" bind:value={state.step} />
              {when(
                verifying,
                () => (
                  <>
                    <input type="hidden" name="email" value={state.email()} />
                    <p class="text-muted-foreground text-sm">
                      We sent a verification code to{" "}
                      <span class="text-areia-foreground font-medium">{state.email()}</span>.{" "}
                      <button
                        type="button"
                        data-change-email
                        class="cursor-pointer underline underline-offset-2"
                      >
                        Change email
                      </button>
                    </p>
                    <Input
                      data-testid="login-otp"
                      name="otp"
                      label="Verification Code"
                      placeholder="000000"
                      autocomplete="one-time-code"
                      inputmode="numeric"
                      autofocus
                    />
                  </>
                ),
                () => (
                  <Input
                    data-testid="login-email"
                    type="email"
                    name="email"
                    label="Email Address"
                    placeholder="your@email.com"
                    value={state.email()}
                    autocomplete="email"
                  />
                ),
              )}
              <Button
                data-testid="login-submit"
                type="submit"
                variant="primary"
                class="w-full"
                disabled={state.busy()}
              >
                {when(
                  state.busy(),
                  () => (verifying ? "Signing In…" : "Sending Code…"),
                  () => (verifying ? "Sign In" : "Send Code"),
                )}
              </Button>
              {when(verifying, () => (
                <p class="text-muted-foreground text-center text-sm">
                  Didn't get it?{" "}
                  <button
                    type="button"
                    data-resend-otp
                    class="cursor-pointer underline underline-offset-2"
                  >
                    Resend code
                  </button>
                </p>
              ))}
            </form>
          </LayerCard.Content>
        </LayerCard>
      </div>
    );
  });
