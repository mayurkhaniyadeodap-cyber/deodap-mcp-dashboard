import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { apiErrorMessage } from "@/services/api";
import { useChangePassword } from "@/services/profile.service";

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z.string().min(8, "New password must be at least 8 characters"),
    confirm_password: z.string().min(1, "Please confirm your new password"),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match",
  })
  .refine((d) => d.new_password !== d.current_password, {
    path: ["new_password"],
    message: "New password must be different from the current password",
  });
type PasswordForm = z.infer<typeof passwordSchema>;

/** Shared Change Password card (reused by /profile and Settings → Security). */
export function ChangePasswordCard() {
  const { toast } = useToast();
  const change = useChangePassword();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  const onSubmit = handleSubmit((values) => {
    change.mutate(
      { current_password: values.current_password, new_password: values.new_password },
      {
        onSuccess: () => {
          reset({ current_password: "", new_password: "", confirm_password: "" });
          toast({ title: "Password updated", variant: "success" });
        },
        onError: (err) =>
          toast({ title: "Couldn't change password", description: apiErrorMessage(err), variant: "error" }),
      },
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" /> Change Password
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Current Password</Label>
            <Input type="password" autoComplete="current-password" {...register("current_password")} aria-invalid={Boolean(errors.current_password)} />
            {errors.current_password && <p className="text-xs text-destructive">{errors.current_password.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input type="password" autoComplete="new-password" {...register("new_password")} aria-invalid={Boolean(errors.new_password)} />
            {errors.new_password && <p className="text-xs text-destructive">{errors.new_password.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Confirm New Password</Label>
            <Input type="password" autoComplete="new-password" {...register("confirm_password")} aria-invalid={Boolean(errors.confirm_password)} />
            {errors.confirm_password && <p className="text-xs text-destructive">{errors.confirm_password.message}</p>}
          </div>
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? <Loader2 className="animate-spin" /> : null} Update Password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
