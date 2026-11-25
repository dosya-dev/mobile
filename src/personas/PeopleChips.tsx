// "In this photo": the people this phone's Personas found in one photo
// (engine.peopleInFile), as chips that open each persona's screen. Ported
// from the desktop's components/personas/PeopleChips.tsx (from
// apps/web/src/components/personas/people-chips.tsx) - keep in step.
//
// Nothing is asked of a server: the engine answers from the decrypted index
// on this phone. The engine is loaded on demand, so the viewer does not carry
// it. Shown only while Personas is ready; off, locked, signed out or a
// failure hide the row. It follows the index: a rename elsewhere shows at
// once. Each face is a crop of this photo's own thumbnail.
//
// The engine host is required lazily (as src/auth/purge.ts does the Vault
// store): it pulls in the e2ee bundle, which must not load with the viewer.
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import type { Box, PersonasEngine } from "@dosya-dev/personas-engine";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { isolateInRtl, useT } from "@/lib/i18n";
import { personaHref } from "./api";
import { FaceAvatar } from "./FaceAvatar";

export interface PeopleChipsProps {
  wsId: string;
  fileId: string;
  /** Opens a persona; pushes /personas/[id] when not given. */
  onOpen?: (personaId: string) => void;
}

type Chip = { persona_id: string; name: string | null; box: Box };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadEngineHost = () => require("./device/engine-host") as typeof import("./device/engine-host");

/** One chip per shown persona (a persona can have two faces in a photo); faces of no shown persona have no screen. */
function chipsOf(engine: PersonasEngine, fileId: string): Chip[] {
  const seen = new Set<string>();
  const out: Chip[] = [];
  for (const f of engine.peopleInFile(fileId)) {
    if (!f.persona_id || seen.has(f.persona_id)) continue;
    seen.add(f.persona_id);
    out.push({ persona_id: f.persona_id, name: f.name, box: f.box });
  }
  return out;
}

export function PeopleChips({ wsId, fileId, onOpen }: PeopleChipsProps) {
  const t = useT();
  const router = useRouter();
  const [people, setPeople] = useState<{ fileId: string; list: Chip[] } | null>(null);

  useEffect(() => {
    if (!wsId || !fileId) return;
    let cancelled = false;
    let unsubscribe = () => {};
    const show = (list: Chip[]) => { if (!cancelled) setPeople({ fileId, list }); };
    void (async () => {
      let engine: PersonasEngine;
      try {
        engine = loadEngineHost().personasEngine(wsId);
      } catch {
        show([]);
        return;
      }
      const update = async () => {
        try {
          const st = await engine.status();
          show(st.state === "ready" ? chipsOf(engine, fileId) : []);
        } catch {
          show([]);
        }
      };
      if (cancelled) return;
      unsubscribe = engine.subscribe(() => { void update(); });
      await update();
    })();
    return () => { cancelled = true; unsubscribe(); };
  }, [wsId, fileId]);

  if (!people || people.fileId !== fileId || people.list.length === 0) return null;

  const open = (personaId: string) => {
    if (onOpen) onOpen(personaId);
    else router.push(personaHref(personaId));
  };

  return (
    <View testID="viewer-people" className="mb-3.5">
      <Text className="mb-2 text-[9.5px] uppercase text-muted-foreground" style={{ fontFamily: fonts.mono, letterSpacing: 1.5 }}>
        {t("personas.label.inThisPhoto")}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {people.list.map((p) => {
          const name = p.name ?? t("common.label.unnamed");
          return (
            <Pressable
              key={p.persona_id}
              testID={`people-chip-${p.persona_id}`}
              accessibilityRole="button"
              accessibilityLabel={name}
              onPress={() => open(p.persona_id)}
              className="min-h-[44px] flex-row items-center gap-2 rounded-full border border-border bg-background py-1 ps-1 pe-3"
            >
              <FaceAvatar fileId={fileId} box={p.box} name={p.name} size={32} />
              <Text className="max-w-[160px] text-sm text-foreground" style={{ fontFamily: fonts.medium }} numberOfLines={1}>
                {p.name ? isolateInRtl(p.name) : name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
