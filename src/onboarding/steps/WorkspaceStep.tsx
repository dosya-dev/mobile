import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { t as moduleT, useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { createWorkspace, getRegions, type RegionInfo } from "@/files/api";
import { LocationPicker } from "@/files/LocationPicker";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useAuthStore } from "@/auth/authStore";
import { StepScreen } from "../ui/StepScreen";

/** Message keys, not text: the names are produced at render so they follow the language. */
const QUICK_PICKS: MessageKey[] = ["common.label.personal", "common.label.photos", "onboarding.label.work"];

/**
 * A required form is not a decision. The account already told us a name at
 * signup, so the field arrives filled and the common case is a single tap.
 */
export function defaultWorkspaceName(userName: string | null | undefined): string {
  const first = (userName ?? "").trim().split(/\s+/)[0];
  return first ? moduleT("onboarding.label.firstSFiles", { first }) : moduleT("onboarding.label.myFiles");
}

export function WorkspaceStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(() => defaultWorkspaceName(user?.name));
  const [busy, setBusy] = useState(false);
  // Where this workspace's files will live. Chosen here and only here: the
  // server refuses to move a workspace afterwards and ignores a region on any
  // upload, so there is no second chance and no per-upload override anywhere in
  // the app.
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [region, setRegion] = useState("");
  const [regionsLoading, setRegionsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getRegions();
        if (cancelled) return;
        setRegions(res.regions);
        // The server's nearest-location guess, so the common case is one tap
        // fewer rather than an empty required field. Only honoured when the
        // list actually offers it: preselecting a code with no matching row
        // would show nothing chosen while this step believed otherwise.
        setRegion(res.regions.some((r) => r.code === res.suggested) ? res.suggested : "");
      } catch {
        // Swallowed on purpose - see `noLocationChoice`. A locations outage
        // costs the choice, never the workspace.
        if (!cancelled) setRegions([]);
      } finally {
        if (!cancelled) setRegionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Nothing to choose from: the request failed, or the server offered no
  // locations. Either way this step stays usable - it creates without a
  // location and lets the server pick the nearest one, rather than disabling
  // the only button on the screen with nothing to act on.
  const noLocationChoice = !regionsLoading && regions.length === 0;
  // `busy` (state) drives the button's visible loading/disabled look, but a state
  // update only becomes visible on the *next* render - it can't stop a second call
  // that lands in the same tick as the first, before that render has happened. A
  // ref is mutated in place and read back immediately, so it closes that gap too:
  // belt-and-braces against a second tap landing before the UI has had a chance
  // to disable itself.
  const inFlight = useRef(false);

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      // `undefined` rather than "", so the request unambiguously asks the
      // server to suggest a location. (It would read an empty string the same
      // way, but a key carrying nothing invites a future reader to send one.)
      const ws = await createWorkspace(trimmed, region || undefined);
      // useWorkspaces has staleTime 5min and a mounted observer, so without
      // this nothing refetches: for five minutes after a new user names their
      // workspace the header on every tab read "No workspace", the photo
      // step's subtitle degraded to "your workspace", and that string was
      // persisted as workspace_name in the first backup's history row. The
      // code this step replaced (WorkspaceGate) invalidated here, and
      // WorkspaceSwitcher still does.
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      await useWorkspaceStore.getState().setActive(ws.id);
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error.couldnTCreateTheWorkspace"), "error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <StepScreen
      step={1}
      testID="onboarding-workspace"
      title={t("onboarding.heading.nameYourFirstWorkspace")}
      subtitle={t("onboarding.description.aWorkspaceHoldsYourFilesYourBackupsAndAnyoneYouShareThemWithYou")}
      primaryLabel={t("common.continue")}
      onPrimary={() => { void onCreate(); }}
      primaryLoading={busy}
      // Held while the catalog is in flight, and again once it has arrived
      // with nothing chosen - the choice is permanent, so creating early or
      // creating blind would both silently spend it on the server's guess.
      // (`region` is "" whenever the suggestion is not in the list.) NOT held
      // when there is nothing to choose from: a failed or empty catalog
      // creates without a location by design. Same expression as web's
      // create-workspace.tsx and desktop's CreateWorkspacePage.
      primaryDisabled={!name.trim() || regionsLoading || (!region && !noLocationChoice)}
    >
      <TextField label={t("create-workspace.label.workspaceName")} testID="workspace-name" value={name} onChangeText={setName} />
      <View className="mt-3 flex-row flex-wrap gap-2">
        {QUICK_PICKS.map((pick) => {
          const q = t(pick);
          const selected = q === name;
          return (
            <Pressable
              key={pick}
              accessibilityRole="button"
              accessibilityLabel={q}
              accessibilityState={{ selected }}
              onPress={() => setName(q)}
              className={
                "min-h-[36px] rounded-full px-3.5 py-2 " +
                (selected ? "bg-primary" : "bg-secondary")
              }
            >
              <Text
                className={"text-sm " + (selected ? "text-primary-foreground" : "text-secondary-foreground")}
                style={{ fontFamily: fonts.medium }}
              >
                {q}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mt-6">
        <Text className="mb-1 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
          {t("common.label.location")}
        </Text>
        <Text
          testID="location-explainer"
          className="mb-2 text-xs text-muted-foreground"
          style={{ fontFamily: fonts.regular }}
        >
          {t("onboarding.description.whereThisWorkspaceSFilesAreStoredChosenOnce")}
        </Text>
        {noLocationChoice ? (
          <Text testID="location-error" className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t("onboarding.error.locationsCouldnTBeLoadedYourWorkspaceWillBeCreatedInTheOneClosest")}
          </Text>
        ) : (
          <LocationPicker regions={regions} value={region} onChange={setRegion} />
        )}
      </View>
    </StepScreen>
  );
}
