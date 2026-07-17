import { ChangePasswordCard } from "@/components/shared/ChangePasswordCard";
import { ProfileDetailsCard } from "@/components/shared/ProfileDetailsCard";

export default function ProfilePage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <ProfileDetailsCard />
      <ChangePasswordCard />
    </div>
  );
}
