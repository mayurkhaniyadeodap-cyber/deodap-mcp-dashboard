import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import type { ChangePasswordRequest, MessageResponse, ProfileUpdate, UserOut } from "@/types/api";

/** GET /api/profile — the currently authenticated user's record. */
export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async () => (await api.get<UserOut>("/profile")).data,
  });
}

/** PATCH /api/profile — updates name/email/phone; refreshes the auth store so
 *  the navbar name/avatar update immediately. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: async (body: ProfileUpdate) => (await api.patch<UserOut>("/profile", body)).data,
    onSuccess: (updated) => {
      if (user) {
        setUser({ ...user, name: updated.full_name, email: updated.email, role: updated.role });
      }
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

/** POST /api/profile/change-password. */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (body: ChangePasswordRequest) =>
      (await api.post<MessageResponse>("/profile/change-password", body)).data,
  });
}
