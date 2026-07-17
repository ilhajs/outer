import { getClient } from "$lib/outer";
import { getInstanceById } from "$lib/store";
import { loader, navigate, type InferLoader } from "@ilha/router";
import { extractFormData, validateWithSchema } from "@ilha/store/form";
import { Button, Input, LayerCard } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
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
  const client = getClient(instance.url);
  const authSession = await client.auth.getSession();
  if (authSession.data) {
    navigate(`/i/${instanceId}`);
    return {};
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
    email: z.string(),
  }),
  z.object({
    step: z.literal(FORM_STEP.VERIFY_OTP),
    email: z.string(),
    otp: z.string(),
  }),
]);

export default ilha
  .input<InferLoader<typeof clientLoad>>()
  .state("step", FORM_STEP.REQUEST_OTP as keyof typeof FORM_STEP)
  .on("#login-form@submit", async ({ input, state, event }) => {
    event.preventDefault();
    const client = getClient(input.instance!.url);
    const formData = extractFormData(event.target as HTMLFormElement);
    const result = validateWithSchema(LoginSchema, formData);
    if (!result.ok) {
      return void toast.error(result.issues[0].message);
    }
    if (result.data.step === FORM_STEP.REQUEST_OTP) {
      const { error } = await client.auth.emailOtp.sendVerificationOtp({
        email: result.data.email,
        type: "sign-in",
      });
      if (error) {
        return void toast.error(error.message);
      }
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
  })
  .render(({ input, state }) => (
    <div class="flex min-h-screen flex-col items-center justify-center gap-4">
      <LayerCard class="max-w-lg">
        <LayerCard.Title>Sign In To {input.instance?.url}</LayerCard.Title>
        <LayerCard.Content>
          <form id="login-form" class="flex flex-col gap-2">
            <input type="hidden" name="step" bind:value={state.step} />
            <Input name="email" label="Email Address" placeholder="your@email.com" />
            {when(state.step() === FORM_STEP.VERIFY_OTP, () => (
              <Input name="otp" label="Verification Code" placeholder="000000" />
            ))}
            <Button type="submit" variant="primary" class="w-full">
              Sign In
            </Button>
          </form>
        </LayerCard.Content>
      </LayerCard>
    </div>
  ));
