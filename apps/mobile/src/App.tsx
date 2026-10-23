import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import {
  request,
  loadToken,
  saveToken,
  money,
  dateLabel,
  RequestError,
  type Loan,
  type Summary,
  type User,
} from "./api";

const colors = {
  ink: "#203E36",
  green: "#214E40",
  lime: "#E5EEB8",
  bg: "#F5F6F0",
  muted: "#6D7C73",
  line: "#E3E8DD",
  danger: "#A34F36",
  redBg: "#FFF1E8",
};
const initialSummary: Summary = {
  totalLentPaise: 0,
  totalRepaidPaise: 0,
  outstandingPaise: 0,
  overduePaise: 0,
  entryCount: 0,
  today: "",
  currency: "INR",
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        compact && s.compact,
        (disabled || pressed) && { opacity: 0.65 },
      ]}
    >
      <Text style={[s.buttonText, secondary && { color: colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType = "default",
  maxLength,
  secure = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad" | "decimal-pad" | "number-pad";
  maxLength?: number;
  secure?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#8C978E"
        keyboardType={keyboardType}
        maxLength={maxLength}
        secureTextEntry={secure}
        autoCapitalize="none"
        style={s.input}
      />
    </View>
  );
}

function Brand() {
  return (
    <View style={s.brand}>
      <View style={s.mark}>
        <Text style={s.markText}>m.</Text>
      </View>
      <Text style={s.brandName}>
        MiniLedger<Text style={{ color: "#8FA37D" }}>.</Text>
      </Text>
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const wide = width > 800;
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loans, setLoans] = useState<Loan[]>([]);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("All entries");
  const [showForm, setShowForm] = useState(false);
  const [friend, setFriend] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [receipt, setReceipt] = useState<ImagePicker.ImagePickerAsset | null>(
    null,
  );
  const [formError, setFormError] = useState("");
  const [repaidLoan, setRepaidLoan] = useState<Loan | null>(null);
  const [receiptImage, setReceiptImage] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    await saveToken(null);
    setToken(null);
    setUser(null);
    setLoans([]);
    setSummary(initialSummary);
    setOtpSent(false);
    setCode("");
    setError("");
    setNotice("");
    setShowForm(false);
    setRepaidLoan(null);
    setReceiptImage(null);
  }, []);

  const refresh = useCallback(async (activeToken: string) => {
    const [entries, totals] = await Promise.all([
      request<{ loans: Loan[] }>("/loans", activeToken),
      request<Summary>("/summary", activeToken),
    ]);
    setLoans(entries.loans);
    setSummary(totals);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await loadToken();
        if (saved) {
          const result = await request<{ user: User }>("/me", saved);
          await refresh(saved);
          setToken(saved);
          setUser(result.user);
        }
      } catch (e) {
        await saveToken(null);
        setError(message(e));
      } finally {
        setReady(true);
      }
    })();
  }, [refresh]);

  useEffect(() => {
    if (!otpSent) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [otpSent]);

  const handleError = async (e: unknown) => {
    if (e instanceof RequestError && e.status === 401) {
      await signOut();
      setError("Your session expired. Please sign in again.");
    } else setError(message(e));
  };

  const sendOtp = async () => {
    setError("");
    if (!/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
      setError(
        "Enter your phone number with country code, such as +919876543210.",
      );
      return;
    }
    setBusy(true);
    try {
      await request("/auth/request-otp", undefined, {
        method: "POST",
        body: JSON.stringify({ phone: phone.trim() }),
      });
      setOtpSent(true);
      setCode("");
      setResendAt(Date.now() + 30000);
      setTick(Date.now());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit OTP from the backend terminal.");
      return;
    }
    setBusy(true);
    try {
      const result = await request<{ token: string; user: User }>(
        "/auth/verify-otp",
        undefined,
        { method: "POST", body: JSON.stringify({ phone: phone.trim(), code }) },
      );
      await saveToken(result.token);
      setToken(result.token);
      setUser(result.user);
      await refresh(result.token);
    } catch (e) {
      await handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const onRefresh = async () => {
    if (!token) return;
    setRefreshing(true);
    setError("");
    try {
      await refresh(token);
    } catch (e) {
      await handleError(e);
    } finally {
      setRefreshing(false);
    }
  };

  const openForm = () => {
    setFriend("");
    setAmount("");
    setDueDate(summary.today);
    setReceipt(null);
    setFormError("");
    setError("");
    setShowForm(true);
  };

  const pickReceipt = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
          setFormError("Choose a receipt smaller than 5 MB.");
          return;
        }
        setReceipt(asset);
        setFormError("");
      }
    } catch (e) {
      setFormError(message(e));
    }
  };

  const addLoan = async () => {
    setFormError("");
    if (!friend.trim() || friend.trim().length > 80) {
      setFormError("Enter a friend’s name, up to 80 characters.");
      return;
    }
    if (
      !/^\d{1,7}(\.\d{1,2})?$/.test(amount) ||
      Number(amount) <= 0 ||
      Number(amount) > 1000000
    ) {
      setFormError(
        "Enter an amount between ₹0.01 and ₹10,00,000, with up to two decimals.",
      );
      return;
    }
    const date = new Date(`${dueDate}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== dueDate ||
      dueDate < "2000-01-01" ||
      dueDate > "2100-12-31"
    ) {
      setFormError("Enter a valid date as YYYY-MM-DD.");
      return;
    }
    if (!token) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("friendName", friend.trim());
      form.append("amount", amount);
      form.append("dueDate", dueDate);
      if (receipt) {
        if (Platform.OS === "web") {
          const blob =
            receipt.file ?? (await (await fetch(receipt.uri)).blob());
          form.append("receipt", blob, receipt.fileName ?? "receipt.jpg");
        } else
          form.append("receipt", {
            uri: receipt.uri,
            name: receipt.fileName ?? "receipt.jpg",
            type: receipt.mimeType ?? "image/jpeg",
          } as unknown as Blob);
      }
      await request("/loans", token, { method: "POST", body: form });
      setShowForm(false);
      setNotice(`Entry for ${friend.trim()} added.`);
      await refresh(token);
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) await handleError(e);
      else setFormError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const markRepaid = async () => {
    if (!token || !repaidLoan) return;
    setBusy(true);
    setError("");
    try {
      await request(`/loans/${repaidLoan.id}/repay`, token, {
        method: "PATCH",
      });
      setRepaidLoan(null);
      setNotice("Repayment recorded. All square!");
      await refresh(token);
    } catch (e) {
      setRepaidLoan(null);
      await handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const viewReceipt = async (loan: Loan) => {
    if (!token) return;
    setError("");
    try {
      const result = await request<{ dataUrl: string }>(
        `/loans/${loan.id}/receipt`,
        token,
      );
      setReceiptImage(result.dataUrl);
    } catch (e) {
      await handleError(e);
    }
  };

  const logout = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await request("/auth/logout", token, { method: "POST" });
      await signOut();
    } catch (e) {
      await handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const shiftDate = (days: number) => {
    const d = new Date(`${summary.today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    setDueDate(d.toISOString().slice(0, 10));
  };

  if (!ready)
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.loading}>
          <Brand />
          <ActivityIndicator size="large" color={colors.green} />
        </View>
      </SafeAreaView>
    );

  if (!token || !user)
    return (
      <SafeAreaView style={s.screen}>
        <StatusBar style="dark" />
        <ScrollView
          contentContainerStyle={s.loginOuter}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.loginWrap}>
            <Brand />
            <View style={s.loginCard}>
              <View style={s.loginArt}>
                <View style={s.artCoin}>
                  <Text style={s.artCoinText}>₹</Text>
                </View>
                <View style={s.artNote}>
                  <Text style={s.artNoteSmall}>FRIENDSHIP FIRST</Text>
                  <Text style={s.artNoteText}>Keep things{"\n"}clear.</Text>
                  <Text style={s.artNoteSmall}>
                    A little ledger. A lot less awkward.
                  </Text>
                </View>
              </View>
              <View style={{ padding: wide ? 36 : 25 }}>
                <Text style={s.eyebrow}>GOOD FRIENDS. CLEAR ACCOUNTS.</Text>
                <Text style={s.loginTitle}>
                  {otpSent ? "One small step." : "Money lent.\nPeace of mind."}
                </Text>
                <Text style={s.body}>
                  {otpSent
                    ? `Enter the code for ${phone.trim()}.`
                    : "A simple home for the money you lend to friends. Nothing forgotten, nothing awkward."}
                </Text>
                {error ? (
                  <Text accessibilityRole="alert" style={s.error}>
                    {error}
                  </Text>
                ) : null}
                {otpSent ? (
                  <>
                    <Field
                      label="Six-digit OTP"
                      value={code}
                      onChange={(value) => setCode(value.replace(/\D/g, ""))}
                      placeholder="000000"
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                    <Text style={s.hint}>
                      Mock login: your OTP is printed in the backend terminal.
                      It expires in 5 minutes.
                    </Text>
                    <Button
                      label={busy ? "Signing in…" : "Verify & open ledger →"}
                      onPress={verify}
                      disabled={busy}
                    />
                    <View style={s.loginActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setOtpSent(false);
                          setError("");
                        }}
                        disabled={busy}
                      >
                        <Text style={s.link}>Change number</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={sendOtp}
                        disabled={busy || tick < resendAt}
                      >
                        <Text style={s.link}>
                          {tick < resendAt
                            ? `Resend in ${Math.ceil((resendAt - tick) / 1000)}s`
                            : "Resend OTP"}
                        </Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Field
                      label="Phone number"
                      value={phone}
                      onChange={setPhone}
                      placeholder="+919876543210"
                      keyboardType="phone-pad"
                      maxLength={16}
                    />
                    <Text style={s.hint}>
                      Include your country code. No SMS is sent in this demo.
                    </Text>
                    <Button
                      label={busy ? "Generating OTP…" : "Get login code →"}
                      onPress={sendOtp}
                      disabled={busy}
                    />
                  </>
                )}
                <View style={s.loginFoot}>
                  <Text style={s.lock}>◈</Text>
                  <Text style={s.hint}>
                    Your ledger stays yours. Phone-based sign in.
                  </Text>
                </View>
              </View>
            </View>
            <Text style={s.footer}>SMALL LOANS. STRONG FRIENDSHIPS.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );

  const visible = loans.filter(
    (loan) =>
      filter === "All entries" ||
      (filter === "Unpaid" && !loan.repaidAt) ||
      (filter === "Repaid" && loan.repaidAt) ||
      (filter === "Overdue" && loan.overdue),
  );
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="dark" />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.green}
          />
        }
        contentContainerStyle={s.dashboard}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[s.header, { maxWidth: 1120 }]}>
          <Brand />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={logout}
            disabled={busy}
            style={s.signOut}
          >
            <Text style={s.signOutText}>
              {wide ? user.phone + "   ·   Sign out" : "Sign out ↗"}
            </Text>
          </Pressable>
        </View>
        <View style={s.content}>
          <View style={s.titleRow}>
            <View>
              <Text style={s.eyebrow}>YOUR PERSONAL LEDGER</Text>
              <Text style={s.pageTitle}>A little clarity.</Text>
              <Text style={s.body}>Keep track. Stay on good terms.</Text>
            </View>
            {wide && <Button label="+ Add entry" onPress={openForm} compact />}
          </View>
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss notification"
              onPress={() => setNotice("")}
            >
              <Text style={s.notice}>{notice} ×</Text>
            </Pressable>
          ) : null}
          <View style={s.balanceCard}>
            <View>
              <Text style={s.balanceLabel}>YET TO COME BACK</Text>
              <Text testID="outstanding-balance" style={s.balance}>
                {money(summary.outstandingPaise)}
              </Text>
              <Text style={s.balanceCaption}>
                {loans.filter((loan) => !loan.repaidAt).length} open{" "}
                {loans.filter((loan) => !loan.repaidAt).length === 1
                  ? "entry"
                  : "entries"}{" "}
                · a little reminder goes a long way.
              </Text>
            </View>
            <View style={s.balanceArt}>
              <Text style={s.balanceArtText}>↗</Text>
            </View>
            <View style={s.balanceBottom}>
              <View>
                <Text style={s.balanceBottomLabel}>TOTAL LENT</Text>
                <Text testID="total-lent" style={s.balanceBottomValue}>
                  {money(summary.totalLentPaise)}
                </Text>
              </View>
              <View style={s.balanceDivider} />
              <View>
                <Text style={s.balanceBottomLabel}>REPAID</Text>
                <Text testID="total-repaid" style={s.balanceBottomValue}>
                  {money(summary.totalRepaidPaise)}
                </Text>
              </View>
              <View style={s.balanceDivider} />
              <View>
                <Text style={s.balanceBottomLabel}>OVERDUE</Text>
                <Text
                  testID="total-overdue"
                  style={[s.balanceBottomValue, { color: "#F4CCA4" }]}
                >
                  {money(summary.overduePaise)}
                </Text>
              </View>
            </View>
          </View>
          {!wide && (
            <View style={{ marginTop: 18 }}>
              <Button label="+ Add a loan entry" onPress={openForm} />
            </View>
          )}
          <View style={s.ledgerHeading}>
            <Text style={s.sectionTitle}>
              The little details
              <Text style={{ color: "#A5AD9B" }}> / {loans.length}</Text>
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh ledger"
              onPress={onRefresh}
              disabled={refreshing}
            >
              <Text style={s.link}>
                {refreshing ? "Refreshing…" : "Refresh ↻"}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.filters}
          >
            {["All entries", "Unpaid", "Repaid", "Overdue"].map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: item === filter }}
                onPress={() => setFilter(item)}
                style={[s.filter, item === filter && s.activeFilter]}
              >
                <Text
                  style={[s.filterText, item === filter && s.activeFilterText]}
                >
                  {item}
                  {item === "Overdue" && loans.some((loan) => loan.overdue)
                    ? " •"
                    : ""}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {visible.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Text style={{ fontSize: 32, color: colors.green }}>↗</Text>
              </View>
              <Text style={s.emptyTitle}>
                {loans.length ? "All clear here." : "Start on a good note."}
              </Text>
              <Text style={[s.body, { textAlign: "center", maxWidth: 300 }]}>
                {loans.length
                  ? "No entries match this view. Try another filter."
                  : "Add the first amount you lent. We’ll keep the details together for you."}
              </Text>
              {!loans.length && (
                <View style={{ marginTop: 20 }}>
                  <Button
                    label="Add your first entry"
                    onPress={openForm}
                    secondary
                    compact
                  />
                </View>
              )}
            </View>
          ) : (
            <View style={s.loanList}>
              {visible.map((loan) => (
                <View
                  key={loan.id}
                  style={[s.loanCard, loan.overdue && s.overdueCard]}
                >
                  <View style={s.loanTop}>
                    <View
                      style={[
                        s.avatar,
                        loan.overdue && { backgroundColor: "#F6DCCA" },
                        !!loan.repaidAt && { backgroundColor: "#E0ECD9" },
                      ]}
                    >
                      <Text style={s.avatarText}>
                        {loan.friendName.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={s.friendInfo}>
                      <Text style={s.friendName}>{loan.friendName}</Text>
                      <Text style={s.due}>
                        {loan.repaidAt
                          ? "Settled · thank you!"
                          : `Due ${dateLabel(loan.dueDate)}`}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={s.loanAmount}>
                        {money(loan.amountPaise)}
                      </Text>
                      <View
                        style={[
                          s.badge,
                          loan.overdue && { backgroundColor: "#F8DDCA" },
                          !!loan.repaidAt && { backgroundColor: "#DFEAD8" },
                        ]}
                      >
                        <Text
                          style={[
                            s.badgeText,
                            loan.overdue && { color: colors.danger },
                          ]}
                        >
                          {loan.repaidAt
                            ? "REPAID ✓"
                            : loan.overdue
                              ? "OVERDUE"
                              : "UNPAID"}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {(!loan.repaidAt || loan.hasReceipt) && (
                    <View style={s.loanActions}>
                      {loan.hasReceipt ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`View receipt for ${loan.friendName}`}
                          onPress={() => viewReceipt(loan)}
                        >
                          <Text style={s.link}>↳ View receipt</Text>
                        </Pressable>
                      ) : (
                        <Text style={s.smallMuted}>
                          A friendly reminder never hurts.
                        </Text>
                      )}
                      {!loan.repaidAt && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Mark ${loan.friendName} as repaid`}
                          onPress={() => setRepaidLoan(loan)}
                          disabled={busy}
                          style={s.repayButton}
                        >
                          <Text style={s.repayText}>Mark repaid ↗</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
          <Text style={s.footer}>
            MADE FOR MONEY BETWEEN FRIENDS. NOT BETWEEN STRANGERS.
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={showForm}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setShowForm(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={s.overlay}
        >
          <ScrollView
            style={{ width: "100%" }}
            contentContainerStyle={s.modalScroll}
            keyboardShouldPersistTaps="handled"
          >
            <View accessibilityViewIsModal style={s.modalCard}>
              <View style={s.modalTitleRow}>
                <View>
                  <Text style={s.eyebrow}>KEEP THE DETAILS TOGETHER</Text>
                  <Text style={s.modalTitle}>A new entry.</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close new entry"
                  onPress={() => setShowForm(false)}
                  disabled={busy}
                >
                  <Text style={s.close}>×</Text>
                </Pressable>
              </View>
              <Text style={s.body}>Lent a little? Make a note of it.</Text>
              {formError ? (
                <Text accessibilityRole="alert" style={s.error}>
                  {formError}
                </Text>
              ) : null}
              <Field
                label="Friend’s name"
                value={friend}
                onChange={setFriend}
                placeholder="e.g. Aarav"
                maxLength={80}
              />
              <Field
                label="Amount lent (₹)"
                value={amount}
                onChange={setAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
                maxLength={10}
              />
              <Field
                label="Due date (YYYY-MM-DD)"
                value={dueDate}
                onChange={setDueDate}
                placeholder="2026-10-30"
                maxLength={10}
              />
              <View style={s.quickDates}>
                {[
                  ["Today", 0],
                  ["In 7 days", 7],
                  ["In 30 days", 30],
                ].map(([label, days]) => (
                  <Pressable
                    key={String(label)}
                    accessibilityRole="button"
                    onPress={() => shiftDate(Number(days))}
                    style={s.quickDate}
                  >
                    <Text style={s.quickDateText}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  receipt ? "Change receipt photo" : "Attach receipt photo"
                }
                onPress={pickReceipt}
                style={s.upload}
              >
                <Text style={s.uploadText}>
                  {receipt
                    ? "✓ Receipt attached · tap to change"
                    : "+ Attach a receipt photo"}
                </Text>
                <Text style={s.smallMuted}>
                  Optional · PNG, JPEG or WebP · up to 5 MB
                </Text>
              </Pressable>
              {receipt && (
                <View style={s.receiptPreview}>
                  <Image source={{ uri: receipt.uri }} style={s.receiptThumb} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove receipt"
                    onPress={() => setReceipt(null)}
                  >
                    <Text style={s.link}>Remove</Text>
                  </Pressable>
                </View>
              )}
              <Button
                label={busy ? "Saving entry…" : "Save entry →"}
                onPress={addLoan}
                disabled={busy}
              />
              <Text style={[s.hint, { textAlign: "center", marginTop: 14 }]}>
                Only you can see your entries and receipts.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!repaidLoan}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setRepaidLoan(null);
        }}
      >
        <View style={s.overlay}>
          <View style={[s.modalCard, { maxWidth: 420 }]}>
            <Text style={s.eyebrow}>ALL SQUARE?</Text>
            <Text style={s.modalTitle}>A good feeling.</Text>
            <Text style={[s.body, { marginVertical: 18 }]}>
              Confirm you received {money(repaidLoan?.amountPaise ?? 0)} back
              from {repaidLoan?.friendName}. This marks the full entry as
              repaid.
            </Text>
            <Button
              label={busy ? "Recording…" : "Yes, received in full ✓"}
              onPress={markRepaid}
              disabled={busy}
            />
            <View style={{ height: 10 }} />
            <Button
              label="Not yet"
              onPress={() => setRepaidLoan(null)}
              secondary
              disabled={busy}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!receiptImage}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptImage(null)}
      >
        <View style={s.overlay}>
          <View style={s.modalCard}>
            <View style={s.modalTitleRow}>
              <Text style={s.modalTitle}>Receipt</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close receipt"
                onPress={() => setReceiptImage(null)}
              >
                <Text style={s.close}>×</Text>
              </Pressable>
            </View>
            {receiptImage && (
              <Image
                accessibilityLabel="Loan receipt photo"
                source={{ uri: receiptImage }}
                resizeMode="contain"
                style={{ width: "100%", height: 360 }}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 35 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: {
    backgroundColor: colors.green,
    height: 39,
    width: 39,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: {
    color: colors.lime,
    fontSize: 27,
    fontWeight: "700",
    lineHeight: 32,
  },
  brandName: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.9,
  },
  loginOuter: {
    flexGrow: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  loginWrap: { width: "100%", maxWidth: 470, alignItems: "center", gap: 28 },
  loginCard: {
    backgroundColor: "#fff",
    width: "100%",
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.line,
  },
  loginArt: {
    height: 156,
    backgroundColor: "#E9EED9",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 28,
    gap: 22,
  },
  artCoin: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#D3DDA2",
    borderWidth: 1,
    borderColor: "#BFCB85",
    justifyContent: "center",
    alignItems: "center",
    transform: [{ rotate: "-14deg" }],
  },
  artCoinText: {
    fontSize: 43,
    color: colors.green,
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
  },
  artNote: { flex: 1, gap: 8 },
  artNoteSmall: { fontSize: 9, color: "#516449", letterSpacing: 0.8 },
  artNoteText: {
    fontSize: 26,
    color: colors.green,
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
    lineHeight: 29,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.6,
    marginBottom: 12,
  },
  loginTitle: {
    color: colors.ink,
    fontSize: 39,
    lineHeight: 43,
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
    letterSpacing: -1.2,
    marginBottom: 14,
  },
  body: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  field: { marginTop: 21 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 9,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D9E0D5",
    borderRadius: 12,
    backgroundColor: "#FCFDF9",
    padding: 15,
    fontSize: 15,
    color: colors.ink,
    minHeight: 50,
  },
  hint: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 16,
    marginVertical: 10,
  },
  button: {
    backgroundColor: colors.green,
    borderRadius: 13,
    paddingVertical: 16,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  secondary: {
    backgroundColor: "#EAF0DF",
    borderWidth: 1,
    borderColor: "#D9E4CC",
  },
  compact: { paddingVertical: 12, paddingHorizontal: 19, minHeight: 44 },
  loginActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 18,
  },
  link: {
    color: colors.green,
    fontSize: 11,
    fontWeight: "600",
    paddingVertical: 7,
  },
  loginFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 18,
  },
  lock: { color: colors.muted, fontSize: 18 },
  footer: {
    color: "#8B9687",
    fontSize: 8,
    letterSpacing: 1.2,
    textAlign: "center",
    lineHeight: 15,
    marginVertical: 28,
  },
  dashboard: { alignItems: "center", paddingHorizontal: 20, paddingBottom: 20 },
  header: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  signOut: { paddingVertical: 10 },
  signOutText: { color: colors.muted, fontSize: 10 },
  content: { width: "100%", maxWidth: 850 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 34,
    marginBottom: 25,
  },
  pageTitle: {
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
    color: colors.ink,
    fontSize: 35,
    letterSpacing: -1,
    marginBottom: 8,
  },
  balanceCard: {
    backgroundColor: colors.green,
    borderRadius: 22,
    padding: 25,
    overflow: "hidden",
  },
  balanceLabel: {
    color: "#CEDCBC",
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: "600",
  },
  balance: {
    color: "#fff",
    fontSize: 44,
    letterSpacing: -1.3,
    marginTop: 12,
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
  },
  balanceCaption: {
    color: "#B7C9B9",
    fontSize: 10,
    marginTop: 10,
    maxWidth: "82%",
    lineHeight: 17,
  },
  balanceArt: {
    position: "absolute",
    right: 22,
    top: 26,
    width: 68,
    height: 68,
    borderWidth: 1,
    borderColor: "#60816A",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "12deg" }],
  },
  balanceArtText: { color: "#D5E4B0", fontSize: 35 },
  balanceBottom: {
    borderTopWidth: 1,
    borderTopColor: "#4B6C54",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 25,
    paddingTop: 20,
  },
  balanceBottomLabel: { color: "#B6C7B5", fontSize: 8, letterSpacing: 1 },
  balanceBottomValue: {
    color: "#EAF0DB",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 7,
  },
  balanceDivider: { width: 1, backgroundColor: "#4B6C54", marginHorizontal: 9 },
  ledgerHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 32,
    marginBottom: 14,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 19,
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
  },
  filters: { gap: 8, paddingBottom: 18 },
  filter: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 30,
  },
  activeFilter: { backgroundColor: "#E4ECD5", borderColor: "#D1DCBC" },
  filterText: { color: colors.muted, fontSize: 11 },
  activeFilterText: { color: colors.green, fontWeight: "600" },
  empty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#D3DCCB",
    borderRadius: 18,
    padding: 34,
    alignItems: "center",
    backgroundColor: "#FAFBF5",
  },
  emptyIcon: {
    width: 65,
    height: 65,
    backgroundColor: "#EAF0DE",
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 22,
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
    marginBottom: 12,
  },
  loanList: { gap: 13 },
  loanCard: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 17,
  },
  overdueCard: { backgroundColor: "#FFF9F3", borderColor: "#EBD5BF" },
  loanTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#E9EDDF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.green,
    fontSize: 20,
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
  },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 14, color: colors.ink, fontWeight: "600" },
  due: { color: colors.muted, fontSize: 10, marginTop: 7 },
  loanAmount: { fontSize: 18, color: colors.ink, fontWeight: "600" },
  badge: {
    borderRadius: 5,
    backgroundColor: "#EDF0E5",
    paddingHorizontal: 7,
    paddingVertical: 4,
    marginTop: 7,
  },
  badgeText: {
    fontSize: 7,
    letterSpacing: 0.6,
    color: colors.green,
    fontWeight: "700",
  },
  loanActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 15,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 8,
  },
  repayButton: {
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: "#E9EEDC",
  },
  repayText: { fontSize: 10, fontWeight: "600", color: colors.green },
  smallMuted: { color: colors.muted, fontSize: 9, lineHeight: 15 },
  error: {
    color: "#943F2C",
    backgroundColor: "#FFF0E8",
    padding: 13,
    borderRadius: 10,
    fontSize: 12,
    lineHeight: 18,
    marginVertical: 13,
  },
  notice: {
    color: colors.green,
    backgroundColor: "#E5EDD7",
    padding: 13,
    borderRadius: 10,
    fontSize: 12,
    marginBottom: 16,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(18,40,30,0.48)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modalScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    width: "100%",
  },
  modalCard: {
    width: "100%",
    maxWidth: 500,
    borderRadius: 24,
    backgroundColor: "#fff",
    padding: 25,
  },
  modalTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  modalTitle: {
    color: colors.ink,
    fontSize: 28,
    fontFamily: Platform.OS === "android" ? "serif" : "Georgia",
  },
  close: { color: colors.muted, fontSize: 28, padding: 8 },
  quickDates: { flexDirection: "row", gap: 8, marginTop: 10 },
  quickDate: {
    backgroundColor: "#F0F3E9",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  quickDateText: { color: colors.green, fontSize: 10 },
  upload: {
    padding: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#C7D3B9",
    borderRadius: 12,
    marginVertical: 20,
    gap: 6,
  },
  uploadText: { fontSize: 12, color: colors.green, fontWeight: "600" },
  receiptPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    marginBottom: 18,
  },
  receiptThumb: { height: 60, width: 60, borderRadius: 8 },
});
