import { client } from "$lib/outer";
import type { AuthSession } from "$lib/types";
import { head, navigate } from "@ilha/router";
import { store } from "@ilha/store";
import { preventDefault } from "@ilha/store/form";
import { Input, LayerCard, Button } from "areia";
import { toast } from "areia/sonner";
import ilha from "ilha";
import { z } from "zod";

const STEP = {
  REQUEST_OTP: "REQUEST_OTP",
  VERIFY_OTP: "VERIFY_OTP",
} as const;

const LoginSchema = z
  .object({
    step: z.enum([STEP.REQUEST_OTP, STEP.VERIFY_OTP]),
    email: z.email(),
    otp: z.string(),
  })
  .default({ step: STEP.REQUEST_OTP, email: "", otp: "" });

const form = store(LoginSchema)
  .onError(({ error, issues }) => {
    const message =
      issues?.[0]?.message ?? (error instanceof Error ? error.message : "Something went wrong");
    toast.error(message);
  })
  .action("submit", async (_, { get }) => {
    const { step, email, otp } = get();
    if (step === STEP.REQUEST_OTP) {
      const { error } = await client.auth.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (error) return void toast.error(error.message);
      return { step: STEP.VERIFY_OTP };
    }
    const { error } = await client.auth.signIn.emailOtp({ email, otp });
    if (error) return void toast.error(error.message);
    navigate("/");
    return;
  })
  .build();

export default ilha
  .input<{ session: AuthSession }>()
  .on("#login-form@submit", preventDefault(form.submit))
  .onMount(({ input }) => {
    if (!input.session) return;
    navigate("/");
  })
  .render(() => {
    head({ title: "Login" });
    return (
      <div class="flex flex-1 flex-col items-center justify-center">
        <LayerCard class="max-w-xl">
          <LayerCard.Title>Sign In</LayerCard.Title>
          <LayerCard.Content>
            <form id="login-form">
              <Input
                type="email"
                label="Email"
                placeholder="your@email.com"
                bind:value={form.email}
              />
              {form.step() === STEP.VERIFY_OTP && (
                <Input type="text" label="OTP" placeholder="123456" bind:value={form.otp} />
              )}
              <Button type="submit" variant="primary" class="w-full justify-center">
                {form.step() === STEP.VERIFY_OTP ? "Verify code" : "Send verification code"}
              </Button>
            </form>
          </LayerCard.Content>
        </LayerCard>
      </div>
    );
  });
