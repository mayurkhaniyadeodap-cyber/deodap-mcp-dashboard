import { Pencil, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { type Column, DataTable } from "@/components/shared/DataTable";
import { FilterBar } from "@/components/shared/FilterBar";
import { PageError } from "@/components/shared/PageError";
import { SearchInput } from "@/components/shared/SearchInput";
import { UserFormModal, type UserFormValues } from "@/components/shared/UserFormModal";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/useAuth";
import { useTable } from "@/hooks/useTable";
import { apiErrorMessage } from "@/services/api";
import { useCreateUser, useDeleteUser, useUpdateUser, useUsers } from "@/services/users.service";
import type { UserOut } from "@/types/api";
import { ROLE_LABELS } from "@/types/app";

type FormState = { mode: "add" } | { mode: "edit"; user: UserOut } | null;

/**
 * User Management (Admin only). CRUD over /api/users with search, loading
 * skeleton and empty state. Rendered inside the Configuration page's settings
 * nav and reused by the standalone /users route. New members are created as
 * Employee (the backend assigns the role); deleting your own account is blocked.
 */
export function UsersSection() {
  const { data, isLoading, isError, refetch } = useUsers();
  const { user: currentUser } = useAuth();
  const { toast } = useToast();

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const [form, setForm] = useState<FormState>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserOut | null>(null);

  const rows = data ?? [];
  const table = useTable<UserOut & Record<string, unknown>>({
    data: rows as (UserOut & Record<string, unknown>)[],
    searchKeys: ["full_name", "email", "phone"],
    initialSort: { key: "full_name", dir: "asc" },
    pageSize: 10,
  });

  if (isError) return <PageError onRetry={() => refetch()} />;

  const columns: Column<UserOut>[] = [
    { key: "full_name", header: "Full Name", sortable: true, cell: (u) => <span className="font-medium">{u.full_name}</span> },
    { key: "email", header: "Email Address", sortable: true, cell: (u) => u.email },
    { key: "phone", header: "Phone Number", sortable: true, cell: (u) => u.phone },
    {
      key: "role",
      header: "Role",
      sortable: true,
      cell: (u) => (
        <span className="inline-flex items-center rounded-full border border-border bg-accent/40 px-2 py-0.5 text-xs font-medium">
          {ROLE_LABELS[u.role]}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (u) => {
        const isSelf = u.id === currentUser?.id;
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setForm({ mode: "edit", user: u })} aria-label={`Edit ${u.full_name}`}>
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(u)}
              disabled={isSelf}
              title={isSelf ? "You can't delete your own account" : undefined}
              aria-label={`Delete ${u.full_name}`}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  const onFormSubmit = (values: UserFormValues) => {
    if (form?.mode === "add") {
      createUser.mutate(
        { full_name: values.full_name, email: values.email, phone: values.phone, password: values.password ?? "" },
        {
          onSuccess: () => {
            setForm(null);
            toast({ title: "Member added", variant: "success" });
          },
          onError: (err) => toast({ title: "Couldn't add member", description: apiErrorMessage(err), variant: "error" }),
        },
      );
    } else if (form?.mode === "edit") {
      updateUser.mutate(
        { id: form.user.id, body: { full_name: values.full_name, email: values.email, phone: values.phone, password: values.password ?? null } },
        {
          onSuccess: () => {
            setForm(null);
            toast({ title: "Member updated", variant: "success" });
          },
          onError: (err) => toast({ title: "Couldn't update member", description: apiErrorMessage(err), variant: "error" }),
        },
      );
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteUser.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast({ title: "Member deleted", variant: "success" });
      },
      onError: (err) => {
        setDeleteTarget(null);
        toast({ title: "Couldn't delete member", description: apiErrorMessage(err), variant: "error" });
      },
    });
  };

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchInput
          value={table.search}
          onChange={table.setSearch}
          placeholder="Search name, email, or phone…"
          className="sm:w-72"
        />
        <Button className="sm:ml-auto" onClick={() => setForm({ mode: "add" })}>
          <UserPlus className="size-4" /> Add Member
        </Button>
      </FilterBar>

      <DataTable
        columns={columns}
        data={table.rows}
        getRowId={(u) => u.id}
        loading={isLoading}
        sort={table.sort}
        onSortChange={table.setSort}
        emptyTitle="No members"
        emptyMessage="Add a member to get started."
      />

      {form && (
        <UserFormModal
          mode={form.mode}
          initial={form.mode === "edit" ? form.user : undefined}
          isPending={createUser.isPending || updateUser.isPending}
          onClose={() => setForm(null)}
          onSubmit={onFormSubmit}
        />
      )}

      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title={`Delete ${deleteTarget.full_name}?`}
          description="This action cannot be undone."
          size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteUser.isPending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDelete} disabled={deleteUser.isPending}>
                Delete
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
