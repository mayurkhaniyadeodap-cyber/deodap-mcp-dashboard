import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { apiErrorMessage } from "@/services/api";
import { useProfile, useUpdateProfile } from "@/services/profile.service";

const profileSchema = z.object({
  full_name: z.string().min(1, "Full name is required"),
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  phone: z.string().min(1, "Phone number is required"),
});
type ProfileForm = z.infer<typeof profileSchema>;

/**
 * Shared Profile Details card (fetch + edit/save). Reused by /profile and the
 * Settings → Profile section so the logic isn't duplicated.
 */
export function ProfileDetailsCard() {
  const { data, isLoading } = useProfile();
  const { toast } = useToast();
  const update = useUpdateProfile();
  const [editing, setEditing] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: data ? { full_name: data.full_name, email: data.email, phone: data.phone } : undefined,
  });

  useEffect(() => {
    if (data) reset({ full_name: data.full_name, email: data.email, phone: data.phone });
  }, [data, reset]);

  const onSubmit = handleSubmit((values) => {
    update.mutate(values, {
      onSuccess: () => {
        setEditing(false);
        toast({ title: "Profile updated", variant: "success" });
      },
      onError: (err) => toast({ title: "Update failed", description: apiErrorMessage(err), variant: "error" }),
    });
  });

  const onCancel = () => {
    if (data) reset({ full_name: data.full_name, email: data.email, phone: data.phone });
    setEditing(false);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-4 text-primary" /> Profile Details
        </CardTitle>
        {!editing && !isLoading && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> Edit Profile
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input {...register("full_name")} disabled={!editing} aria-invalid={Boolean(errors.full_name)} />
              {errors.full_name && <p className="text-xs text-destructive">{errors.full_name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Email Address</Label>
              <Input type="email" {...register("email")} disabled={!editing} aria-invalid={Boolean(errors.email)} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input {...register("phone")} disabled={!editing} aria-invalid={Boolean(errors.phone)} />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
            </div>
            {editing && (
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={onCancel} disabled={update.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending ? <Loader2 className="animate-spin" /> : null} Save Changes
                </Button>
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
