import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { MessageResponse, UserCreate, UserOut, UserUpdate } from "@/types/api";

/** GET /api/users — all members (admin only). */
export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<UserOut[]>("/users")).data,
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["users"] });
}

/** POST /api/users — create a member (backend assigns the default Viewer role). */
export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (body: UserCreate) => (await api.post<UserOut>("/users", body)).data,
    onSuccess: invalidate,
  });
}

/** PATCH /api/users/{id} — edit a member (password optional). */
export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: UserUpdate }) =>
      (await api.patch<UserOut>(`/users/${id}`, body)).data,
    onSuccess: invalidate,
  });
}

/** DELETE /api/users/{id}. */
export function useDeleteUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete<MessageResponse>(`/users/${id}`)).data,
    onSuccess: invalidate,
  });
}
