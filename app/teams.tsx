import { useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { roleLabel, timeAgo } from "@/files/workspace-format";
import { getTeam, getRoles, inviteToWorkspace, removeMember, changeMemberRole, type TeamMember } from "@/workspace/api";
import { usePermissions } from "@/workspace/usePermissions";
import { canGrantRole } from "@/workspace/roleGrant";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { ActionSheet } from "@/ui/ActionSheet";
import { Icon } from "@/ui/Icon";
import { Pressable } from "react-native";

function errMessage(t: T, e: unknown): string {
  return e instanceof Error ? e.message : t("common.error.somethingWentWrongTryAgain");
}

export default function TeamsScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const qc = useQueryClient();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [inviteRole, setInviteRole] = useState("role_member");
  /** The member whose role sheet is open, and the row mid-flight. */
  const [roleTarget, setRoleTarget] = useState<TeamMember | null>(null);
  const [changingRole, setChangingRole] = useState(false);

  const { can, permissions } = usePermissions();
  const canManageRoles = can("manage_roles");
  const canInvite = can("invite_members");

  // The workspace's roles, so both the invite picker and the per-member role
  // sheet can offer CUSTOM roles, not just the builtins.
  const { data: rolesData } = useQuery({
    queryKey: ["roles", activeId],
    queryFn: () => getRoles(activeId!),
    enabled: !!activeId,
    staleTime: 60_000,
  });
  // role_owner is excluded: ownership is transferred, never assigned.
  const assignableRoles = (rolesData?.roles ?? []).filter((r) => r.id !== "role_owner");
  // Narrowed further to what THIS caller may hand out (see roleGrant.ts, which
  // reads only our permissions, never our role id): a custom role was offered
  // Admin, and an admin was offered a custom role granting lock_files, and
  // each tap ended in a 403. While permissions are still loading the list
  // stays whole, matching can().
  const grantableRoles = permissions
    ? assignableRoles.filter((r) => canGrantRole(permissions, r))
    : assignableRoles;
  // The default chip is Member; a caller who cannot grant Member falls to the
  // first role they can, rather than sending a role the server will refuse.
  const effectiveInviteRole = grantableRoles.some((r) => r.id === inviteRole)
    ? inviteRole
    : grantableRoles[0]?.id ?? inviteRole;

  /**
   * Display name for a role id, preferring the workspace's own list.
   *
   * roleLabel() alone can only name the four builtins and falls back to a
   * generic label, so every member holding a custom role rendered identically
   * and indistinguishably.
   */
  const roleName = (id: string) => rolesData?.roles.find((r) => r.id === id)?.name ?? roleLabel(id);

  const confirmRemove = async () => {
    const m = removing;
    setRemoving(null);
    if (!m) return;
    try {
      await removeMember(m.membership_id);
      await qc.invalidateQueries({ queryKey: ["team", activeId] });
      toast(t("team.status.removedName", { name: m.name || m.email }));
    } catch (e) {
      // e.g. "Cannot remove the workspace owner. Transfer ownership first."
      toast(errMessage(t, e), "error");
    }
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["team", activeId],
    queryFn: () => getTeam(activeId!),
    enabled: !!activeId,
  });

  const invite = async () => {
    if (!activeId) return;
    setInviting(true);
    try {
      // The role is passed now. This call used to omit it entirely, so the
      // server's `?? "role_member"` default applied and every invite sent from
      // a phone created a Member - there was no picker at all, and no way to
      // change the role afterwards either.
      await inviteToWorkspace(activeId, email.trim(), effectiveInviteRole);
      await qc.invalidateQueries({ queryKey: ["team", activeId] });
      setEmail("");
      toast(t("common.label.invitationSent"));
    } catch (e) {
      // e.g. "You don't have invite permission" - the server's message is the useful one.
      toast(errMessage(t, e), "error");
    }
    setInviting(false);
  };

  const applyRole = async (roleId: string) => {
    const m = roleTarget;
    if (!m) return;
    if (roleId === m.role_id) { setRoleTarget(null); return; }
    setChangingRole(true);
    try {
      await changeMemberRole(m.membership_id, roleId);
      await qc.invalidateQueries({ queryKey: ["team", activeId] });
      // roleName, not roleLabel: the latter calls every custom role "Custom role".
      toast(t("team.status.nameIsNowRoleName", { name: m.name || m.email, roleName: roleName(roleId) }));
      setRoleTarget(null);
    } catch (e) {
      toast(errMessage(t, e), "error");
    }
    setChangingRole(false);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("team.heading.teams") }} />
      <Screen underNativeHeader>
        {!activeId || isLoading ? (
          <View testID="team-loading" className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center">
            {/* Listing members needs view_team_members; a limited role legitimately can't. */}
            <Text className="mb-3 text-center text-destructive" style={{ fontFamily: fonts.regular }}>
              {t("team.error.couldnTLoadMembersYourRoleMayNotAllowViewingThem")}
            </Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <>
            {/* Inviting needs invite_members; without it the card's only outcome was a 403 toast. */}
            {canInvite ? (
            <View className="mb-4 gap-2 rounded-lg border border-border bg-card p-4">
              <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("team.label.inviteToWorkspace")}</Text>
              <TextField
                testID="invite-email"
                value={email}
                onChangeText={setEmail}
                placeholder={t("common.placeholder.nameExampleCom")}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              {/* A real role picker. There was none: every invite sent from a
                  phone became a Member, and the copy below said so as if it
                  were a design decision rather than a missing control. */}
              <View className="flex-row flex-wrap gap-2">
                {grantableRoles.map((r) => {
                  const selected = r.id === effectiveInviteRole;
                  return (
                    <Pressable
                      key={r.id}
                      testID={`invite-role-${r.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={t("team.action.inviteAsName", { name: r.name })}
                      onPress={() => setInviteRole(r.id)}
                      className={
                        "rounded-full border px-3 py-1.5 " +
                        (selected ? "border-primary bg-primary/10" : "border-border bg-background")
                      }
                    >
                      <Text
                        className={"text-xs capitalize " + (selected ? "text-primary" : "text-muted-foreground")}
                        style={{ fontFamily: selected ? fonts.medium : fonts.regular }}
                      >
                        {r.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Button title={t("team.action.sendInvite")} testID="invite-send" onPress={invite} loading={inviting} disabled={!email.trim()} />
            </View>
            ) : null}

            <Text className="mb-2 text-xs uppercase text-muted-foreground" style={{ fontFamily: fonts.medium }}>
              {t("common.label.members")}
            </Text>
            <View className="overflow-hidden rounded-lg border border-border bg-card">
              <FlatList
                data={data?.members ?? []}
                keyExtractor={(m) => m.membership_id}
                ListEmptyComponent={
                  <View className="items-center py-6">
                    <Text className="text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("team.label.noMembers")}</Text>
                  </View>
                }
                renderItem={({ item, index }) => (
                  <View
                    testID={`member-${item.membership_id}`}
                    className={
                      "flex-row items-center gap-3 px-4 py-3" +
                      (index < (data?.members.length ?? 0) - 1 ? " border-b border-border" : "")
                    }
                  >
                    <Avatar initials={item.name || item.email} color={tokens.muted} textColor={tokens.mutedForeground} size={32} radius={16} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>
                        {item.name || item.email}
                      </Text>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>
                        {t("team.label.emailJoinedTimeAgo", { email: item.email, timeAgo: timeAgo(item.joined_at) })}
                      </Text>
                    </View>
                    {/* Tapping the role badge opens the role picker, for anyone
                        who may manage roles. The owner's badge stays inert -
                        ownership moves by transfer, and the endpoint refuses.
                        So does the caller's own: the server answers "You
                        cannot change your own role", and is_you comes from the
                        team payload rather than from can(), which fails open
                        while permissions load. */}
                    {item.is_you ? <View testID={`you-${item.membership_id}`}><Badge label={t("common.label.you")} variant="outline" /></View> : null}
                    {!item.is_you && canManageRoles && item.role_id !== "role_owner" ? (
                      <Pressable
                        testID={`role-${item.membership_id}`}
                        accessibilityRole="button"
                        accessibilityLabel={t("team.action.changeRoleForName", { name: item.name || item.email })}
                        hitSlop={8}
                        onPress={() => setRoleTarget(item)}
                        className="flex-row items-center gap-1"
                      >
                        <Badge label={roleName(item.role_id)} />
                        <Icon name="chevron-down" size={12} color={tokens.mutedForeground} />
                      </Pressable>
                    ) : (
                      <Badge label={roleName(item.role_id)} />
                    )}
                    {/* The owner can't be removed - the server refuses and tells you to
                        transfer first, so don't offer the action at all. Removal also
                        needs manage_roles, which the endpoint checks now instead of
                        comparing role ids, so a viewer no longer gets a button whose
                        only outcome is a 403. Never on the caller's own row: the
                        server permits self-removal, so this button removed YOU. */}
                    {!item.is_you && item.role_id !== "role_owner" && canManageRoles ? (
                      <Pressable
                        testID={`remove-${item.membership_id}`}
                        accessibilityRole="button"
                        accessibilityLabel={t("common.accessibility.removeMName", { mName: item.name || item.email })}
                        hitSlop={8}
                        onPress={() => setRemoving(item)}
                      >
                        <Icon name="close-circle-outline" size={20} color={tokens.destructive} />
                      </Pressable>
                    ) : null}
                  </View>
                )}
              />
            </View>
          </>
        )}

        <ConfirmDialog
          visible={removing !== null}
          title={t("team.heading.removeMember")}
          message={removing ? t("team.description.nameWillLoseAccessToThisWorkspace", { name: removing.name || removing.email }) : undefined}
          confirmLabel={t("common.remove")}
          destructive
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />

        {/* Role picker. Lists this workspace's custom roles alongside the
            builtins, because /api/roles returns both and a workspace-defined
            role was previously unassignable from a phone. */}
        <ActionSheet
          visible={roleTarget !== null && !changingRole}
          onClose={() => setRoleTarget(null)}
          actions={grantableRoles.map((r) => ({
            label: r.id === roleTarget?.role_id ? t("team.label.nameCurrent", { name: r.name }) : r.name,
            onPress: () => applyRole(r.id),
          }))}
        />
      </Screen>
    </>
  );
}
