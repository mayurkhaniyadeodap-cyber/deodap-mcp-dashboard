import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import type { UserOut } from "@/types/api";

export interface UserFormValues {
  full_name: string;
  email: string;
  phone: string;
  /** Empty on edit = keep existing password. */
  password?: string;
}

/** Build the schema; on Add the password is required, on Edit it's optional. */
function makeSchema(requirePassword: boolean) {
  return z
    .object({
      full_name: z.string().min(1, "Full name is required"),
      email: z.string().min(1, "Email is required").email("Enter a valid email"),
      phone: z.string().min(1, "Phone number is required"),
      password: z.string(),
      confirm_password: z.string(),
    })
    .superRefine((d, ctx) => {
      const pw = d.password;
      if (requirePassword || pw.length > 0) {
        if (pw.length < 8) {
          ctx.addIssue({ path: ["password"], code: "custom", message: "Password must be at least 8 characters" });
        }
        if (pw !== d.confirm_password) {
          ctx.addIssue({ path: ["confirm_password"], code: "custom", message: "Passwords do not match" });
        }
      }
    });
}

interface UserFormModalProps {
  mode: "add" | "edit";
  initial?: UserOut;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (values: UserFormValues) => void;
}

export function UserFormModal({ mode, initial, isPending, onClose, onSubmit }: UserFormModalProps) {
  const isAdd = mode === "add";
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(makeSchema(isAdd)),
    defaultValues: {
      full_name: initial?.full_name ?? "",
      email: initial?.email ?? "",
      phone: initial?.phone ?? "",
      password: "",
      confirm_password: "",
    },
  });

  const submit = handleSubmit((v) => {
    onSubmit({
      full_name: v.full_name,
      email: v.email,
      phone: v.phone,
      password: v.password ? v.password : undefined,
    });
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isAdd ? "Add Member" : "Edit Member"}
      description={isAdd ? undefined : "Leave password blank to keep it unchanged."}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : null}
            {isAdd ? "Add Member" : "Save Changes"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-4">
        <Field label="Full Name" error={errors.full_name?.message}>
          <Input {...register("full_name")} aria-invalid={Boolean(errors.full_name)} />
        </Field>
        <Field label="Email Address" error={errors.email?.message}>
          <Input type="email" {...register("email")} aria-invalid={Boolean(errors.email)} />
        </Field>
        <Field label="Phone Number" error={errors.phone?.message}>
          <Input {...register("phone")} aria-invalid={Boolean(errors.phone)} />
        </Field>
        <Field label={isAdd ? "Password" : "New Password (optional)"} error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register("password")} aria-invalid={Boolean(errors.password)} />
        </Field>
        <Field label="Confirm Password" error={errors.confirm_password?.message}>
          <Input type="password" autoComplete="new-password" {...register("confirm_password")} aria-invalid={Boolean(errors.confirm_password)} />
        </Field>
      </form>
    </Modal>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
