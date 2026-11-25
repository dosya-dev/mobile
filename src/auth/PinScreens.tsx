import { useState, type ReactNode } from "react";
import { Pressable } from "react-native";
import { Text } from "@/ui/Text";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import type { IconName } from "@/ui/Icon";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import { PinPad } from "./PinPad";
import { clearAppLock, setPin, verifyPin, WARN_FROM_TRIES, MAX_PIN_TRIES } from "./appLock";
import { useAuthStore } from "./authStore";
import { useAfterDismiss } from "@/ui/afterDismiss";

/** Choose a PIN, then type it again. Saves it and calls `onDone` on a match. */
export function PinSetup(props: {
  title?: string;
  description?: string;
  onDone: () => void;
  /** A text link under the pad, e.g. Cancel or Turn off App lock. */
  secondary?: { label: string; onPress: () => void };
}) {
  const t = useT();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <PinPad
      testID="pin-setup"
      title={first === null ? (props.title ?? t("security.heading.chooseAPin")) : t("security.heading.enterThePinAgain")}
      description={first === null ? props.description : undefined}
      error={error}
      onComplete={async (pin) => {
        if (first === null) {
          setFirst(pin);
          setError(null);
          return;
        }
        if (pin !== first) {
          setFirst(null);
          setError(t("security.error.pinsDidNotMatch"));
          return;
        }
        await setPin(pin);
        props.onDone();
      }}
      footer={props.secondary ? <LinkButton {...props.secondary} testID="pin-secondary" /> : null}
    />
  );
}

/**
 * Asks for the current PIN: the lock screen, and the step in front of Change
 * PIN / Turn off App lock. Owns the wrong-try messages, "Forgot PIN?" and the
 * sign-out at the last try, so both places behave the same.
 */
export function PinCheck(props: {
  title?: string;
  onSuccess: () => void;
  biometric?: { icon: IconName; label: string; onPress: () => void };
  onCancel?: () => void;
}) {
  const t = useT();
  const signOut = useAuthStore((s) => s.signOut);
  const [error, setError] = useState<string | null>(null);
  const [confirmForgot, setConfirmForgot] = useState(false);
  // Sign-out unmounts whatever Modal this sits in; iOS mishandles that while
  // the confirmation is still fading out, so wait for it to be gone.
  const after = useAfterDismiss();

  // Sign out FIRST. signOut can take seconds (server logout), and clearing the
  // PIN before it would leave a window where killing the app reopens it signed
  // in with no lock. The purge that follows the sign-out clears App lock; the
  // call after it covers a purge that was skipped.
  const wipeAndSignOut = async () => {
    await signOut();
    await clearAppLock();
  };

  return (
    <>
      <PinPad
        testID="pin-check"
        title={props.title ?? t("security.heading.enterYourPin")}
        error={error}
        biometric={props.biometric}
        onComplete={async (pin) => {
          const res = await verifyPin(pin);
          if (res.ok) {
            setError(null);
            props.onSuccess();
            return;
          }
          if (res.triesLeft === 0) {
            await wipeAndSignOut();
            toast(t("security.message.tooManyWrongPinTries"), "error");
            return;
          }
          setError(
            MAX_PIN_TRIES - res.triesLeft >= WARN_FROM_TRIES
              ? t("security.error.wrongPinTriesLeft", { count: res.triesLeft })
              : t("security.error.wrongPin"),
          );
        }}
        footer={
          <>
            <LinkButton label={t("security.action.forgotPin")} onPress={() => setConfirmForgot(true)} testID="pin-forgot" />
            {props.onCancel ? <LinkButton label={t("common.cancel")} onPress={props.onCancel} testID="pin-cancel" /> : null}
          </>
        }
      />
      <ConfirmDialog
        visible={confirmForgot}
        title={t("common.heading.areYouSure")}
        message={t("security.description.forgotPinSignsOut")}
        confirmLabel={t("common.action.signOut")}
        destructive
        onCancel={() => setConfirmForgot(false)}
        onDismiss={after.onDismiss}
        onConfirm={() => {
          setConfirmForgot(false);
          after.queue(() => void wipeAndSignOut());
        }}
      />
    </>
  );
}

function LinkButton(props: { label: string; onPress: () => void; testID?: string }): ReactNode {
  return (
    <Pressable testID={props.testID} accessibilityRole="button" onPress={props.onPress} className="px-4 py-2">
      <Text className="text-sm text-primary" style={{ fontFamily: fonts.medium }}>{props.label}</Text>
    </Pressable>
  );
}
