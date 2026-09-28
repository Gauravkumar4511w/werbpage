import { useEffect, useEffectEvent, useRef, useState } from "react";
import freeFireMaxIcon from "./assets/image_10d29343.jpg";
import "./App.css";
import AuthModal from "./components/AuthModal";
import AdminPanel from "./components/AdminPanel";
import HeroSection from "./components/HeroSection";
import LibrarySection from "./components/LibrarySection";
import Navbar from "./components/Navbar";
import TournamentSection from "./components/TournamentSection";
import WalletModal from "./components/WalletModal";
import { EDIT_LOCK_MS, getTeamSize } from "../lib/match-schedule.js";

const userDataStorageKey = "nexus-user-data";

function readPendingPayment() {
  try {
    const payment = JSON.parse(localStorage.getItem("nexus-pending-payment") || "null");
    const expiresAt = Number(payment?.expiresAt);
    if (!payment?.upiUrl || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      localStorage.removeItem("nexus-pending-payment");
      return null;
    }
    return payment;
  } catch {
    localStorage.removeItem("nexus-pending-payment");
    return null;
  }
}

// The key is fixed at sign-up so later profile edits never move the player to a different wallet.
function getUserKey(user) {
  return (user?.userKey || user?.email || user?.phone || user?.name || "guest").trim().toLowerCase();
}

async function postJson(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw Object.assign(new Error(data?.message || "Something went wrong. Please try again."), { status: response.status });
  }
  return data;
}

// Match ids are compared in lower case: the server stores them that way.
function normalizeJoinedMatches(entries) {
  return Array.isArray(entries) ? entries.filter((entry) => entry?.id).map((entry) => ({ ...entry, id: String(entry.id).toLowerCase() })) : [];
}

// The server's entries are the truth, so a match joined on one device shows on every device.
function joinedMatchesFromServer(entries, previous) {
  return entries.map((entry) => {
    const id = String(entry.matchId).toLowerCase();
    const local = previous.find((item) => item.id === id);
    const identifiers = entry.identifiers?.length ? entry.identifiers : local?.identifiers || [local?.identifier].filter(Boolean);
    return {
      id,
      publicId: entry.publicId ? `#${entry.publicId}` : local?.publicId || "",
      mode: entry.mode || local?.mode || "",
      matchTimestamp: Number(entry.matchTimestamp) || local?.matchTimestamp || 0,
      status: entry.status,
      identifier: identifiers[0] || "",
      identifiers,
      roomId: entry.roomId || "",
      roomPassword: entry.roomPassword || "",
    };
  });
}

function readUserData(user) {
  try {
    const allUserData = JSON.parse(localStorage.getItem(userDataStorageKey) || "{}");
    const savedData = allUserData[getUserKey(user)];
    if (savedData) {
      const legacyCoins = Number(savedData.coins) || 0;
      const purchasedCoins = Number.isFinite(Number(savedData.purchasedCoins))
        ? Number(savedData.purchasedCoins)
        : legacyCoins;
      const winningCoins = Number(savedData.winningCoins) || 0;
      return {
        purchasedCoins,
        winningCoins,
        coins: purchasedCoins + winningCoins,
        joinedMatches: normalizeJoinedMatches(savedData.joinedMatches),
      };
    }
    const legacyCoins = Number(user?.coins) || 0;
    return {
      purchasedCoins: legacyCoins,
      winningCoins: 0,
      coins: legacyCoins,
      joinedMatches: [],
    };
  } catch {
    return { purchasedCoins: 0, winningCoins: 0, coins: 0, joinedMatches: [] };
  }
}

function saveUserData(user, data) {
  try {
    const allUserData = JSON.parse(localStorage.getItem(userDataStorageKey) || "{}");
    allUserData[getUserKey(user)] = data;
    localStorage.setItem(userDataStorageKey, JSON.stringify(allUserData));
  } catch {
    return;
  }
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [tournamentsOpen, setTournamentsOpen] = useState(() => window.location.hash === "#tournaments");
  const [adminOpen, setAdminOpen] = useState(() => window.location.hash === "#admin");
  const [focusMatchId, setFocusMatchId] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState("buy");
  const [coins, setCoins] = useState(0);
  const [purchasedCoins, setPurchasedCoins] = useState(0);
  const [winningCoins, setWinningCoins] = useState(0);
  const [buyAmount, setBuyAmount] = useState("");
  const [manualUtr, setManualUtr] = useState("");
  const [pendingPayment, setPendingPayment] = useState(readPendingPayment);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState("upi");
  const [withdrawDetails, setWithdrawDetails] = useState({
    upiId: "",
    accountName: "",
    accountNumber: "",
    ifsc: "",
  });
  const [withdrawalScreenshot, setWithdrawalScreenshot] = useState(null);
  const [walletMessage, setWalletMessage] = useState("");
  const [walletActivity, setWalletActivity] = useState({ payments: [], withdrawals: [] });
  const [walletSyncTick, setWalletSyncTick] = useState(0);
  const [notice, setNotice] = useState(null);
  const paymentStatuses = useRef(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [player, setPlayer] = useState(() => {
    const savedPlayer = localStorage.getItem("nexus-player");
    try {
      return savedPlayer ? JSON.parse(savedPlayer) : null;
    } catch {
      localStorage.removeItem("nexus-player");
      return null;
    }
  });
  const [joinedMatches, setJoinedMatches] = useState([]);
  const userDataReady = useRef(false);
  const authSubmitting = useRef(false);
  const visibleCoins = player ? coins : 0;
  const visibleJoinedMatches = player ? joinedMatches : [];
  const [joinConfirm, setJoinConfirm] = useState(null);
  const [matchDetails, setMatchDetails] = useState(null);
  const [matchHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nexus-match-history")) || [];
    } catch {
      return [];
    }
  });
  const profileStats = {
    level: Math.max(1, Math.floor(matchHistory.filter((match) => match.result === "Victory").length / 5) + 1),
    wins: matchHistory.filter((match) => match.result === "Victory").length,
    tournaments: joinedMatches.length,
  };
  const [form, setForm] = useState({
    username: "",
    email: "",
    phone: "",
    password: "",
    signupMethod: "phone",
    loginMethod: "email",
  });
  const [registeredNames, setRegisteredNames] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nexus-registered-names")) || [];
    } catch {
      return [];
    }
  });
  const [registeredUsers, setRegisteredUsers] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nexus-registered-users")) || [];
    } catch {
      return [];
    }
  });
  const [liveCount, setLiveCount] = useState(() => Math.max(1, registeredUsers.length));

  useEffect(() => {
    let active = true;
    let sessionId = "";
    try {
      sessionId = sessionStorage.getItem("nexus-session-id") || "";
      if (!sessionId) {
        sessionId = "sess-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem("nexus-session-id", sessionId);
      }
    } catch {
      sessionId = "sess-" + Date.now();
    }

    if (registeredUsers.length > 0) {
      fetch("/api/users/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users: registeredUsers }),
      }).catch(() => {});
    }

    const sendHeartbeat = async () => {
      try {
        const userKey = player ? getUserKey(player) : "";
        const res = await fetch("/api/presence/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, userKey }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.liveCount) {
          setLiveCount(data.liveCount);
        }
      } catch {
        // Fallback
      }
    };

    sendHeartbeat();
    const heartbeatTimer = window.setInterval(sendHeartbeat, 6000);
    return () => {
      active = false;
      window.clearInterval(heartbeatTimer);
    };
  }, [player, registeredUsers]);

  useEffect(() => {
    const clock = window.setInterval(() => setCurrentTime(Date.now()), 10000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!player) {
      userDataReady.current = false;
      return;
    }

    const savedData = readUserData(player);
    const loadTimer = window.setTimeout(() => {
      setPurchasedCoins(savedData.purchasedCoins);
      setWinningCoins(savedData.winningCoins);
      setCoins(savedData.purchasedCoins + savedData.winningCoins);
      setJoinedMatches(savedData.joinedMatches);
      userDataReady.current = true;
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [player]);

  useEffect(() => {
    if (!player || !userDataReady.current) return;
    saveUserData(player, { purchasedCoins, winningCoins, coins, joinedMatches });
  }, [player, purchasedCoins, winningCoins, coins, joinedMatches]);

  // Messages outside the wallet (join results, closed matches) show as a toast, so a tap is never silent.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), notice.tone === "error" ? 7000 : 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showNotice = (text, tone = "info") => setNotice({ text, tone, key: Date.now() });

  const applyWallet = (wallet) => {
    setPurchasedCoins(wallet.creditCoins);
    setWinningCoins(wallet.winningCoins);
    setCoins(wallet.totalCoins);
    setWalletActivity({ payments: wallet.payments || [], withdrawals: wallet.withdrawals || [] });
    if (Array.isArray(wallet.entries)) {
      setJoinedMatches((previous) => joinedMatchesFromServer(wallet.entries, previous));
    }
    // A profile edited on another device shows up here too.
    const profile = wallet.profile;
    if (player && profile?.name && (profile.email || profile.phone)
      && (profile.name !== player.name || profile.email !== (player.email || "") || profile.phone !== (player.phone || ""))) {
      storeProfile(profile);
    }
    userDataReady.current = true;
  };
  const onWalletLoaded = useEffectEvent(applyWallet);

  // The server wallet is the source of truth: admin approvals, adjustments, and winnings all land there.
  useEffect(() => {
    if (!player) {
      paymentStatuses.current = null;
      return undefined;
    }
    let active = true;
    const syncWallet = async () => {
      try {
        const wallet = await postJson("/api/users/wallet", { userKey: getUserKey(player), password: player.password });
        if (!active) return;
        onWalletLoaded(wallet);

        const previous = paymentStatuses.current;
        paymentStatuses.current = Object.fromEntries((wallet.payments || []).map((payment) => [payment.id, payment.status]));
        const reviewed = previous ? (wallet.payments || []).filter((payment) => previous[payment.id] === "pending" && payment.status !== "pending") : [];
        const approved = reviewed.filter((payment) => payment.status === "approved");
        const rejected = reviewed.filter((payment) => payment.status === "rejected");
        if (approved.length) {
          setWalletMessage(`Top-up verified! ${approved.reduce((total, payment) => total + payment.coins, 0).toLocaleString()} coins added to your wallet.`);
        } else if (rejected.length) {
          setWalletMessage(`Top-up with UTR ${rejected[0].utr} was rejected${rejected[0].review_note ? `: ${rejected[0].review_note}` : "."}`);
        }
      } catch {
        // Keep showing the last known balance while offline.
      }
    };
    syncWallet();
    const timer = window.setInterval(syncWallet, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [player, walletSyncTick]);

  const requireLogin = () => {
    if (player) return true;

    setAuthMode("login");
    setAuthError("Please log in to continue.");
    setAuthOpen(true);
    return false;
  };

  const openWalletForTopUp = (neededCoins, mode) => {
    window.history.pushState({ view: "wallet" }, "", "#wallet");
    setWalletTab("buy");
    setBuyAmount(String(Math.max(50, neededCoins)));
    const message = `You need ${neededCoins.toLocaleString()} more coins to join ${mode}. Buy coins below, then tap Join again.`;
    setWalletMessage(message);
    showNotice(message, "error");
    setWalletOpen(true);
    setWalletSyncTick((tick) => tick + 1);
  };

  const handleOpenJoinConfirm = (match) => {
    if (!requireLogin()) return;

    const matchId = String(match.id).toLowerCase();
    const existingMatch = joinedMatches.find((entry) => entry.id === matchId);
    const matchStartTime = Number(match.matchTimestamp || existingMatch?.matchTimestamp || 0);

    if (existingMatch) {
      if (matchStartTime && Date.now() >= matchStartTime - EDIT_LOCK_MS) {
        showNotice("You have joined this match. Player names are locked 1 hour before it starts.");
        return;
      }
    } else if (match.status === "confirmed" || (matchStartTime && Date.now() >= matchStartTime)) {
      showNotice("This match has already started, so joining is closed. Pick an upcoming match.", "error");
      return;
    } else if (match.isFull) {
      showNotice("This match is full. Pick another match.", "error");
      return;
    } else if (coins < match.entryFee) {
      openWalletForTopUp(match.entryFee - coins, match.mode);
      return;
    }

    const playerCount = getTeamSize(match.mode);
    const savedIdentifiers = existingMatch?.identifiers?.length ? existingMatch.identifiers : [existingMatch?.identifier || ""];

    setJoinConfirm({
      matchId,
      mode: match.mode,
      cost: match.entryFee,
      playerCount,
      identifiers: Array.from({ length: playerCount }, (_, index) => savedIdentifiers[index] || (index === 0 ? player?.name?.trim() || "" : "")),
      error: "",
      isEditing: Boolean(existingMatch),
    });
  };

  const handleOpenMatchDetails = (match) => {
    if (!requireLogin()) return;
    setMatchDetails({ ...match, id: String(match.id).toLowerCase() });
    // Fetch the latest entry so room details appear as soon as the admin publishes them.
    setWalletSyncTick((tick) => tick + 1);
  };

  const confirmMatchJoin = async () => {
    if (!joinConfirm || joinConfirm.submitting || !requireLogin()) {
      return;
    }

    const identifiers = joinConfirm.identifiers.map((identifier) => identifier.trim());
    if (identifiers.some((identifier) => identifier.length < 3)) {
      setJoinConfirm((previous) => ({
        ...previous,
        error: joinConfirm.playerCount > 1
          ? `Enter all ${joinConfirm.playerCount} in-game names or UIDs (at least 3 characters each).`
          : "Enter your in-game name or UID (at least 3 characters).",
      }));
      return;
    }

    setJoinConfirm((previous) => ({ ...previous, submitting: true, error: "" }));
    let result;
    try {
      result = await postJson("/api/matches/entry", {
        matchId: joinConfirm.matchId,
        identifiers,
        userKey: getUserKey(player),
        password: player.password,
      });
    } catch (error) {
      if (error.status === 402) {
        const missing = Number(error.message.match(/\d+/)?.[0]) || joinConfirm.cost;
        setJoinConfirm(null);
        setWalletSyncTick((tick) => tick + 1);
        openWalletForTopUp(missing, joinConfirm.mode);
        return;
      }
      setJoinConfirm((previous) => previous && { ...previous, submitting: false, error: error.message });
      return;
    }

    applyWallet(result.wallet);
    showNotice(
      joinConfirm.isEditing
        ? `${joinConfirm.mode}: player names updated.`
        : `Joined ${joinConfirm.mode}! ${result.charged.toLocaleString()} coins deducted. Room ID and password appear in the match details 10 minutes before the start.`,
      "success",
    );
    setJoinConfirm(null);
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (authSubmitting.current) return;
    const { username, email, phone, password, signupMethod } = form;

    if (authMode === "signup" && username.trim().length < 3) {
      setAuthError("Choose a gamer tag with at least 3 characters.");
      return;
    }
    if (
      authMode === "signup" &&
      signupMethod === "phone" &&
      !/^\+?[0-9\s-]{10,15}$/.test(phone)
    ) {
      setAuthError("Enter a valid mobile number.");
      return;
    }
    if (
      authMode === "signup" &&
      signupMethod === "email" &&
      !/^\S+@\S+\.\S+$/.test(email)
    ) {
      setAuthError("Enter a valid Gmail or email address.");
      return;
    }
    if (
      authMode === "login" &&
      form.loginMethod === "email" &&
      !/^\S+@\S+\.\S+$/.test(email)
    ) {
      setAuthError("Enter a valid email address.");
      return;
    }
    if (
      authMode === "login" &&
      form.loginMethod === "phone" &&
      !/^\+?[0-9\s-]{10,15}$/.test(phone)
    ) {
      setAuthError("Enter a valid mobile number.");
      return;
    }
    if (
      authMode === "signup" &&
      registeredNames.some(
        (name) => name.toLowerCase() === username.trim().toLowerCase(),
      )
    ) {
      setAuthError(
        `That gamer tag is taken. Try ${username.trim()}${Math.floor(Math.random() * 90) + 10}.`,
      );
      return;
    }
    if (password.length < 6) {
      setAuthError("Your password must be at least 6 characters.");
      return;
    }

    if (authMode === "login") {
      const loginValue = (form.loginMethod === "email" ? email : phone)
        .trim()
        .toLowerCase();
      let account = registeredUsers.find(
        (user) =>
          user[form.loginMethod] === loginValue && user.password === password,
      );
      if (!account) {
        // Accounts made on another phone or browser are only on the server.
        authSubmitting.current = true;
        try {
          const { user } = await postJson("/api/users/login", {
            login: loginValue,
            password,
            sessionId: sessionStorage.getItem("nexus-session-id") || undefined,
          });
          account = { name: user.name, email: user.email || "", phone: user.phone || "", password, userKey: user.userKey, coins: 0, status: "active" };
          const nextUsers = [...registeredUsers.filter((item) => getUserKey(item) !== user.userKey), account];
          localStorage.setItem("nexus-registered-users", JSON.stringify(nextUsers));
          setRegisteredUsers(nextUsers);
        } catch (error) {
          setAuthError(error.message);
          return;
        } finally {
          authSubmitting.current = false;
        }
      }
      const loginCoins = Number(account.coins) || 0;
      setCoins(loginCoins);
      localStorage.setItem("nexus-player", JSON.stringify(account));
      setPlayer(account);
      setAuthOpen(false);
      setForm({
        username: "",
        email: "",
        phone: "",
        password: "",
        signupMethod: "phone",
        loginMethod: "email",
      });

      // Update presence on login
      void fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionStorage.getItem("nexus-session-id") || undefined,
          userKey: getUserKey(account),
        }),
      }).then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (data.liveCount) setLiveCount(data.liveCount);
        }
      }).catch(() => {});
      return;
    }

    const nextPlayer = {
      name: username.trim(),
      email: signupMethod === "email" ? email.trim().toLowerCase() : "",
      phone: signupMethod === "phone" ? phone.trim() : "",
      password,
      coins: 0,
      status: "active",
    };
    nextPlayer.userKey = getUserKey(nextPlayer);
    const accountExists = registeredUsers.some(
      (user) =>
        (nextPlayer.email && user.email === nextPlayer.email) ||
        (nextPlayer.phone && user.phone === nextPlayer.phone),
    );
    if (accountExists) {
      setAuthError(
        "An account already exists with this email or mobile number. Please log in.",
      );
      return;
    }

    // Save the account on the server first: that is what lets it log in and join on any device.
    authSubmitting.current = true;
    try {
      await postJson("/api/users/register", {
        userKey: nextPlayer.userKey,
        displayName: nextPlayer.name,
        email: nextPlayer.email,
        phone: nextPlayer.phone,
        password: nextPlayer.password,
        sessionId: sessionStorage.getItem("nexus-session-id") || undefined,
      });
    } catch (error) {
      setAuthError(error.message);
      return;
    } finally {
      authSubmitting.current = false;
    }
    const nextUsers = [...registeredUsers, nextPlayer];
    const nextNames =
      authMode === "signup"
        ? [...registeredNames, nextPlayer.name]
        : registeredNames;
    localStorage.setItem("nexus-registered-users", JSON.stringify(nextUsers));
    setRegisteredUsers(nextUsers);
    localStorage.setItem("nexus-registered-names", JSON.stringify(nextNames));
    setRegisteredNames(nextNames);
    localStorage.setItem("nexus-player", JSON.stringify(nextPlayer));
    setCoins(0);
    setPlayer(nextPlayer);
    setAuthOpen(false);
    setForm({
      username: "",
      email: "",
      phone: "",
      password: "",
      signupMethod: "phone",
      loginMethod: "email",
    });

    fetch("/api/presence/stats").then((response) => response.json()).then((stats) => {
      if (stats?.liveCount) setLiveCount(stats.liveCount);
    }).catch(() => {});
  };

  const handleSignOut = () => {
    localStorage.removeItem("nexus-player");
    setPlayer(null);
    setCoins(0);
    setPurchasedCoins(0);
    setWinningCoins(0);
    setJoinedMatches([]);
    userDataReady.current = false;
    setLibraryOpen(false);
    setTournamentsOpen(false);
    setWalletOpen(false);
    setFocusMatchId(null);
    setJoinConfirm(null);
    setMatchDetails(null);
    setAuthOpen(false);
  };

  // Saves the edited profile locally for this device (login list and gamer tags) once the server accepts it.
  const storeProfile = (profile) => {
    const userKey = getUserKey(player);
    const nextPlayer = { ...player, userKey, name: profile.name, email: profile.email || "", phone: profile.phone || "" };
    const nextUsers = registeredUsers.some((user) => getUserKey(user) === userKey)
      ? registeredUsers.map((user) => (getUserKey(user) === userKey ? nextPlayer : user))
      : [...registeredUsers, nextPlayer];
    const nextNames = [...registeredNames.filter((name) => name.toLowerCase() !== player.name.toLowerCase()), nextPlayer.name];
    localStorage.setItem("nexus-player", JSON.stringify(nextPlayer));
    localStorage.setItem("nexus-registered-users", JSON.stringify(nextUsers));
    localStorage.setItem("nexus-registered-names", JSON.stringify(nextNames));
    setRegisteredUsers(nextUsers);
    setRegisteredNames(nextNames);
    setPlayer(nextPlayer);
  };

  const handleUpdateProfile = async ({ name, email, phone }) => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();

    if (trimmedName.length < 3 || trimmedName.length > 24)
      return "Choose a gamer tag with 3 to 24 characters.";
    if (trimmedEmail && !/^\S+@\S+\.\S+$/.test(trimmedEmail))
      return "Enter a valid email address.";
    if (trimmedPhone && !/^\+?[0-9\s-]{10,15}$/.test(trimmedPhone))
      return "Enter a valid mobile number.";
    if (!trimmedEmail && !trimmedPhone)
      return "Keep an email or a mobile number so you can log in.";

    try {
      const { user } = await postJson("/api/users/profile", {
        userKey: getUserKey(player),
        password: player.password,
        displayName: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
      });
      storeProfile(user);
    } catch (error) {
      return error.message;
    }
    showNotice("Profile saved. You can log in with your new email or mobile number.", "success");
    return "";
  };

  const openTournaments = (event) => {
    event.preventDefault();
    if (window.location.hash !== "#tournaments") {
      window.history.pushState({ view: "matches" }, "", "#tournaments");
    }
    setFocusMatchId(null);
    setTournamentsOpen(true);
    setLibraryOpen(false);
    setMenuOpen(false);
  };

  const openHome = (event) => {
    event.preventDefault();
    setLibraryOpen(false);
    setTournamentsOpen(false);
    setMenuOpen(false);
  };

  const backToDiscover = () => {
    setFocusMatchId(null);
    setLibraryOpen(false);
    setTournamentsOpen(false);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    const handleBrowserBack = () => {
      setFocusMatchId(null);
      setLibraryOpen(false);
      setTournamentsOpen(false);
      setAdminOpen(window.location.hash === "#admin");
      setWalletOpen(false);
      setAuthOpen(false);
      setMenuOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.addEventListener("popstate", handleBrowserBack);
    window.addEventListener("hashchange", handleBrowserBack);
    return () => {
      window.removeEventListener("popstate", handleBrowserBack);
      window.removeEventListener("hashchange", handleBrowserBack);
    };
  }, []);

  const startUpiPayment = (amount) => {
    if (!requireLogin()) return;

    if (!Number.isInteger(amount) || amount < 50) {
      setWalletMessage("Buy at least 50 whole coins.");
      return;
    }
    const upiId = import.meta.env.VITE_UPI_ID;
    const payeeName = import.meta.env.VITE_UPI_NAME || "ARENACORE";
    if (!upiId || upiId.startsWith("YOUR_")) {
      setWalletMessage("UPI ID is not configured.");
      return;
    }
    const upiUrl = `upi://pay?${new URLSearchParams({
      pa: upiId,
      pn: payeeName,
      am: amount.toFixed(2),
      cu: "INR",
      tn: `ARENACORE ${amount} coins`,
      tr: `AC${Date.now()}`,
    })}`;
    const pending = {
      amount,
      upiUrl,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    localStorage.setItem("nexus-pending-payment", JSON.stringify(pending));
    setPendingPayment(pending);
    setWalletMessage("Scan the QR code to complete your payment.");
  };

  const openPendingUpiPayment = () => {
    if (!requireLogin()) return;

    if (!pendingPayment?.upiUrl || Date.now() >= Number(pendingPayment.expiresAt)) {
      setWalletMessage("This payment QR has expired. Start a new payment.");
      return;
    }
    window.location.assign(pendingPayment.upiUrl);
  };

  const submitPaymentProof = async ({ utr }) => {
    if (!requireLogin() || !pendingPayment) return false;
    try {
      const { payment } = await postJson("/api/payments/request", {
        userKey: getUserKey(player),
        password: player.password,
        amount: pendingPayment.amount,
        utr,
      });
      setWalletActivity((current) => ({ ...current, payments: [payment, ...current.payments] }));
      paymentStatuses.current = { ...(paymentStatuses.current || {}), [payment.id]: payment.status };
    } catch (error) {
      setWalletMessage(error.message);
      return false;
    }
    localStorage.removeItem("nexus-pending-payment");
    setPendingPayment(null);
    setManualUtr("");
    setWalletMessage("Payment proof submitted. Coins will be added as soon as the admin verifies your UTR.");
    return true;
  };

  const requestWithdrawal = async (event) => {
    event.preventDefault();
    if (!requireLogin()) return;

    const amount = Number(withdrawAmount);
    if (!Number.isInteger(amount) || amount < 50) {
      setWalletMessage("Withdraw at least 50 whole coins.");
      return;
    }
    if (amount > coins) {
      setWalletMessage("You do not have enough total coins for this withdrawal.");
      return;
    }
    if (amount > winningCoins) {
      setWalletMessage(`Only ${winningCoins.toLocaleString()} winning coins are withdrawable.`);
      return;
    }
    if (
      withdrawMethod === "upi" &&
      !/^[\w.-]+@[\w.-]+$/.test(withdrawDetails.upiId.trim())
    ) {
      setWalletMessage("Enter a valid UPI ID, for example player@upi.");
      return;
    }
    if (!withdrawalScreenshot) {
      setWalletMessage("Upload your UPI QR screenshot for withdrawal verification.");
      return;
    }
    if (
      withdrawMethod === "bank" &&
      (withdrawDetails.accountName.trim().length < 2 ||
        !/^\d{9,18}$/.test(withdrawDetails.accountNumber) ||
        !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(withdrawDetails.ifsc.trim()))
    ) {
      setWalletMessage(
        "Enter valid account name, account number and IFSC code.",
      );
      return;
    }
    try {
      const { wallet } = await postJson("/api/withdrawals/request", {
        userKey: getUserKey(player),
        password: player.password,
        amount,
        method: withdrawMethod,
        details: { ...withdrawDetails, qrScreenshotName: withdrawalScreenshot.name },
      });
      setPurchasedCoins(wallet.creditCoins);
      setWinningCoins(wallet.winningCoins);
      setCoins(wallet.totalCoins);
      setWalletActivity({ payments: wallet.payments || [], withdrawals: wallet.withdrawals || [] });
    } catch (error) {
      setWalletMessage(error.message);
      return;
    }
    setWalletMessage(
      `Withdrawal request for ${amount.toLocaleString()} coins submitted. It is held until the admin pays it out.`,
    );
    setWithdrawAmount("");
    setWithdrawalScreenshot(null);
  };

  const detailsEntry = matchDetails ? visibleJoinedMatches.find((entry) => entry.id === matchDetails.id) : null;
  const detailsStarted = Boolean(matchDetails?.matchTimestamp) && currentTime >= matchDetails.matchTimestamp;

  return (
    <main className="gaming-page">
      <Navbar
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        player={player}
        setAuthOpen={(open) => {
          if (open) window.history.pushState({ view: "profile" }, "", "#profile");
          setAuthOpen(open);
        }}
        onHome={openHome}
        onHistory={(event) => {
          event.preventDefault();
          if (!requireLogin()) return;
          window.history.pushState({ view: "history" }, "", "#library");
          setTournamentsOpen(false);
          setLibraryOpen(true);
          setMenuOpen(false);
        }}
        libraryOpen={libraryOpen}
        tournamentsOpen={tournamentsOpen}
        onTournaments={openTournaments}
        onCoinClick={() => {
          if (!requireLogin()) return;
          window.history.pushState({ view: "wallet" }, "", "#wallet");
          setWalletOpen(true);
          setWalletMessage("");
          setWalletSyncTick((tick) => tick + 1);
        }}
        onAdmin={() => {
          window.history.pushState({ view: "admin" }, "", "#admin");
          setAdminOpen(true);
          setWalletOpen(false);
          setLibraryOpen(false);
          setTournamentsOpen(false);
          setMenuOpen(false);
        }}
        coinBalance={visibleCoins}
      />
      {adminOpen ? (
        <AdminPanel onBack={() => { setAdminOpen(false); window.history.pushState({ view: "home" }, "", "#discover"); }} />
      ) : tournamentsOpen ? (
        <TournamentSection
          tournamentsOpen={tournamentsOpen}
          onBack={backToDiscover}
          joinedMatches={visibleJoinedMatches}
          onJoinMatch={handleOpenJoinConfirm}
          onMatchDetails={handleOpenMatchDetails}
          focusMatchId={focusMatchId}
        />
      ) : libraryOpen ? (
        <LibrarySection
          libraryOpen={libraryOpen}
          matchHistory={matchHistory}
          joinedMatches={visibleJoinedMatches}
          onBack={() => setLibraryOpen(false)}
          onOpenJoinedMatch={(match) => {
            if (!requireLogin()) return;
            setFocusMatchId(match.id);
            setLibraryOpen(false);
            setTournamentsOpen(true);
          }}
        />
      ) : (
        <HeroSection openTournaments={openTournaments} liveCount={liveCount} />
      )}
      <AuthModal
        authOpen={authOpen}
        setAuthOpen={setAuthOpen}
        authMode={authMode}
        setAuthMode={setAuthMode}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        authError={authError}
        setAuthError={setAuthError}
        form={form}
        setForm={setForm}
        handleAuthSubmit={handleAuthSubmit}
        player={player}
        profileStats={profileStats}
        handleSignOut={handleSignOut}
        onUpdateProfile={handleUpdateProfile}
      />
      {walletOpen && (
        <WalletModal
          key={pendingPayment?.expiresAt || "wallet"}
          coins={visibleCoins}
          creditCoins={player ? purchasedCoins : 0}
          winningCoins={player ? winningCoins : 0}
          withdrawableCoins={player ? winningCoins : 0}
          walletTab={walletTab}
          setWalletTab={(tab) => { setWalletTab(tab); setWalletMessage(""); }}
          onClose={() => setWalletOpen(false)}
          buyAmount={buyAmount}
          setBuyAmount={setBuyAmount}
          onUpiBuy={startUpiPayment}
          onOpenUpiPayment={openPendingUpiPayment}
          manualUtr={manualUtr}
          setManualUtr={setManualUtr}
          pendingPayment={pendingPayment}
          onSubmitPaymentProof={submitPaymentProof}
          paymentHistory={player ? walletActivity.payments : []}
          withdrawAmount={withdrawAmount}
          setWithdrawAmount={setWithdrawAmount}
          withdrawMethod={withdrawMethod}
          setWithdrawMethod={setWithdrawMethod}
          withdrawDetails={withdrawDetails}
          setWithdrawDetails={setWithdrawDetails}
          withdrawalScreenshot={withdrawalScreenshot}
          setWithdrawalScreenshot={setWithdrawalScreenshot}
          requestWithdrawal={requestWithdrawal}
          walletMessage={walletMessage}
        />
      )}
      {matchDetails && (
        <div className="join-confirm-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => event.target === event.currentTarget && setMatchDetails(null)}>
          <div className="join-confirm-modal match-details-modal">
            <button
              type="button"
              className="join-confirm-close"
              onClick={() => setMatchDetails(null)}
              aria-label="Close match details"
            >
              ×
            </button>

            <div className="match-detail-shell">
              <div className="match-detail-header">
                <div>
                  <p className="join-confirm-kicker">match briefing {matchDetails.publicId}</p>
                  <h3>{matchDetails.mode}</h3>
                </div>
                <span className="match-detail-pill">{detailsStarted ? "Live" : "Queued"}</span>
              </div>

              <div className="match-detail-banner">
                <div className="match-detail-banner-glow" />
                <img src={freeFireMaxIcon} alt="Free Fire MAX" />
                <div className="match-detail-banner-overlay">
                  <span>Squad arena</span>
                  <strong>Battle pass ready</strong>
                </div>
              </div>

              <div className="match-detail-grid">
                <div>
                  <span>Entry</span>
                  <strong>{Number(matchDetails.entryFee || 0).toLocaleString()} coins</strong>
                </div>
                <div>
                  <span>Start</span>
                  <strong>
                    {matchDetails.matchTimestamp ? new Date(matchDetails.matchTimestamp).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }) : "To be announced"}
                  </strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{detailsStarted ? "Started" : "Waiting"}</strong>
                </div>
              </div>

              <div className="brief-content">
                <p className="match-description">
                  {matchDetails.description || "This match is built for quick coordination, fair bracket timing, and instant room access for all confirmed players."}
                </p>
                {matchDetails.prizePool !== null && matchDetails.prizePool !== undefined && (
                  <div className="match-prize-box"><span>Prize pool</span><strong>{Number(matchDetails.prizePool).toLocaleString()} coins</strong></div>
                )}

                {detailsEntry && (
                  <div className="match-player-list">
                    <span className="match-player-list-title">Your team</span>
                    <div className="match-team-roster">
                      <span className="match-team-label">Joined</span>
                      <div>
                        {(detailsEntry.identifiers?.length ? detailsEntry.identifiers : [detailsEntry.identifier]).filter(Boolean).map((identifier, playerIndex) => (
                          <span className="match-player-name" key={`${identifier}-${playerIndex}`}>{identifier}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="rules-box">
                  <p className="rules-heading">Rules &amp; Regulations:</p>
                  <ol>
                    <li>Emulator strictly not allowed (Only Mobile Players).</li>
                    <li>Hacking, scripting ya kisi bhi tarah ka unfair gameplay pakde jaane par team ko tournament disqualify kar diya jayega.</li>
                    <li>Room ID and Password match start hone se 10 minute pehle yha pe dia jayega.</li>
                    <li>Minimum level 30 requirement hai khelne ke liye.</li>
                  </ol>
                </div>

                {detailsEntry ? (
                  detailsEntry.roomId ? (
                    <div className="room-info-box">
                      <div className="room-info-row">
                        <span>Room ID</span>
                        <strong>{detailsEntry.roomId}</strong>
                      </div>
                      <div className="room-info-row">
                        <span>Password</span>
                        <strong>{detailsEntry.roomPassword || "No password"}</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="match-detail-lock">
                      {currentTime < matchDetails.matchTimestamp - 10 * 60 * 1000
                        ? "You're in! The room ID and password will appear here 10 minutes before the match starts."
                        : "The room ID and password will appear here as soon as the admin publishes them. Keep this open."}
                    </p>
                  )
                ) : detailsStarted ? (
                  <p className="match-detail-lock">This match has already started, so joining is closed.</p>
                ) : (
                  <p className="match-detail-lock">Join this match to get the room ID and password 10 minutes before the start.</p>
                )}
              </div>
            </div>

            <div className="join-confirm-actions">
              <button type="button" className="join-confirm-secondary" onClick={() => setMatchDetails(null)}>
                Close
              </button>
              {!detailsEntry && !detailsStarted && (
                <button
                  type="button"
                  className="join-confirm-primary"
                  onClick={() => {
                    setMatchDetails(null);
                    handleOpenJoinConfirm(matchDetails);
                  }}
                >
                  Join now
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {joinConfirm && (
        <div className="join-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="join-confirm-modal">
            <button
              type="button"
              className="join-confirm-close"
              onClick={() => setJoinConfirm(null)}
              aria-label="Close join confirmation"
            >
              ×
            </button>
            <p className="join-confirm-kicker">match entry</p>
            <h3>{joinConfirm.mode}</h3>
            <p className="join-confirm-text">
              {joinConfirm.isEditing
                ? "Update your team's in-game names. No extra coins are charged."
                : <>This match will use <strong>{joinConfirm.cost.toLocaleString()} coins</strong> from your wallet ({visibleCoins.toLocaleString()} available).</>}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirmMatchJoin();
              }}
            >
              <div className="join-confirm-players">
                {joinConfirm.identifiers.map((identifier, index) => (
                  <label className="join-confirm-field" key={`player-${index + 1}`}>
                    {joinConfirm.playerCount > 1 ? `Player ${index + 1} in-game name or UID` : "In-game name or UID"}
                    <input
                      type="text"
                      value={identifier}
                      onChange={(event) => setJoinConfirm((previous) => ({
                        ...previous,
                        identifiers: previous.identifiers.map((value, valueIndex) => valueIndex === index ? event.target.value : value),
                        error: "",
                      }))}
                      placeholder={`Enter player ${index + 1} name or UID`}
                      maxLength={24}
                      autoComplete="off"
                      enterKeyHint={index === joinConfirm.identifiers.length - 1 ? "done" : "next"}
                    />
                  </label>
                ))}
              </div>
              {joinConfirm.error && <p className="join-confirm-error" role="alert">{joinConfirm.error}</p>}
              <div className="join-confirm-actions">
                <button type="button" className="join-confirm-secondary" onClick={() => setJoinConfirm(null)}>
                  Cancel
                </button>
                <button type="submit" className="join-confirm-primary" disabled={joinConfirm.submitting}>
                  {joinConfirm.submitting ? "Joining..." : joinConfirm.isEditing ? "Save" : "Confirm & join"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {notice && (
        <div className={`app-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} key={notice.key}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button>
        </div>
      )}
    </main>
  );
}

export default App;
