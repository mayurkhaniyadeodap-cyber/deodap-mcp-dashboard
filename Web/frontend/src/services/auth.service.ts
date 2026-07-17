import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/auth.store";
import type { LoginResponse, User } from "@/types/app";

export interface LoginPayload {
  email: string;
  password: string;
}

/** POST /api/login — on success, persist token+user to the auth store. */
export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { data } = await api.post<LoginResponse>("/login", payload);
      return data;
    },
    onSuccess: (data) => {
      setAuth(data.access_token, data.user);
    },
  });
}

/** GET /api/me — refreshes the current user; only runs when a token exists. */
export function useMe() {
  const token = useAuthStore((s) => s.token);
  const setUser = useAuthStore((s) => s.setUser);
  return useQuery({
    queryKey: ["me"],
    enabled: Boolean(token),
    queryFn: async () => {
      const { data } = await api.get<User>("/me");
      setUser(data);
      return data;
    },
  });
}
