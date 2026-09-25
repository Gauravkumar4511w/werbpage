import { useEffect, useRef, useState } from "react";
import freeFireMaxIcon from "./assets/image_10d29343.jpg";
import "./App.css";
import AuthModal from "./components/AuthModal";
import AdminPanel from "./components/AdminPanel";
import HeroSection from "./components/HeroSection";
import LibrarySection from "./components/LibrarySection";
import Navbar from "./components/Navbar";
import TournamentSection from "./components/TournamentSection";
import WalletModal from "./components/WalletModal";

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

function getUserKey(user) {
  return (user?.email || user?.phone || user?.name || "guest").trim().toLowerCase();
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
        joinedMatches: Array.isArray(savedData.joinedMatches) ? savedData.joinedMatches : [],
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
  const [tournamentsOpen, setTournamentsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
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
      setJoinedMatches(Array.isArray(savedData.joinedMatches) ? savedData.joinedMatches : []);
      userDataReady.current = true;
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [player]);

  useEffect(() => {
    if (!player || !userDataReady.current) return;
    saveUserData(player, { purchasedCoins, winningCoins, coins, joinedMatches });
  }, [player, purchasedCoins, winningCoins, coins, joinedMatches]);

  useEffect(() => {
    if (!player) return;

    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get("payment");
    const orderCoins = Number(params.get("coins") || "0");
    if (paymentStatus !== "success" || !Number.isInteger(orderCoins) || orderCoins <= 0) return;

    const savedData = readUserData(player);
    const nextPurchasedCoins = savedData.purchasedCoins + orderCoins;
    const nextCoins = nextPurchasedCoins + savedData.winningCoins;
    saveUserData(player, { ...savedData, purchasedCoins: nextPurchasedCoins, coins: nextCoins });

    const updatedPlayer = { ...player, coins: nextCoins };
    const updatedUsers = registeredUsers.map((user) => (
      user.email === updatedPlayer.email || user.phone === updatedPlayer.phone
        ? updatedPlayer
        : user
    ));
    localStorage.setItem("nexus-player", JSON.stringify(updatedPlayer));
    localStorage.setItem("nexus-registered-users", JSON.stringify(updatedUsers));
    const paymentTimer = window.setTimeout(() => {
      setPurchasedCoins(nextPurchasedCoins);
      setCoins(nextCoins);
      setPlayer(updatedPlayer);
      setRegisteredUsers(updatedUsers);
      setWalletMessage(`Payment successful! ${orderCoins.toLocaleString()} coins added to your wallet.`);

      const nextUrl = new URL(window.location.href);
      nextUrl.search = "";
      window.history.replaceState({}, "", nextUrl);
    }, 0);
    return () => window.clearTimeout(paymentTimer);
  }, [player, registeredUsers]);

  const requireLogin = () => {
    if (player) return true;

    setAuthMode("login");
    setAuthError("Please log in to continue.");
    setAuthOpen(true);
    return false;
  };

  const handleOpenJoinConfirm = (match) => {
    if (!requireLogin()) return;

    const existingMatch = joinedMatches.find((entry) => entry.id === match.id);
    const matchStartTime = Number(match.matchTimestamp || existingMatch?.matchTimestamp || 0);

    if (existingMatch && matchStartTime && Date.now() >= matchStartTime - 3600000) {
      setWalletMessage("This match is locked for changes. You can edit it only up to 1 hour before it starts.");
      return;
    }

    if (existingMatch && !match.entryFee) {
      return;
    }

    if (!existingMatch && coins < match.entryFee) {
      setWalletMessage(`You need ${match.entryFee - coins} more coins to join ${match.mode}.`);
      return;
    }

    const playerCount = match.mode.includes("Duo") || match.mode.includes("2v2")
      ? 2
      : match.mode.includes("Squad") || match.mode.includes("4v4")
        ? 4
        : 1;
    const savedIdentifiers = existingMatch?.identifiers || [existingMatch?.identifier || ""];

    setJoinConfirm({
      matchId: match.id,
      publicId: match.publicId,
      mode: match.mode,
      cost: match.entryFee,
      playerCount,
      identifiers: Array.from({ length: playerCount }, (_, index) => savedIdentifiers[index] || (index === 0 ? player?.name?.trim() || "" : "")),
      matchTimestamp: matchStartTime || Date.now(),
      error: "",
      isEditing: Boolean(existingMatch),
    });
  };

  const handleOpenMatchDetails = (match) => {
    if (!requireLogin()) return;

    const joinedEntries = joinedMatches.filter((entry) => entry.id === match.id);
    const existingMatch = joinedEntries[0];
    const matchStartTime = Number(match.matchTimestamp || existingMatch?.matchTimestamp || 0);

    setMatchDetails({
      ...match,
      matchTimestamp: matchStartTime || Date.now(),
      joinedEntry: existingMatch || null,
      joinedEntries,
      roomId: match.roomId || `FF-${String(match.id).slice(-6)}`,
      password: match.password || `pw${String(match.id).slice(-4)}`,
    });
  };

  const confirmMatchJoin = () => {
    if (!joinConfirm || !requireLogin()) {
      return;
    }

    const identifiers = joinConfirm.identifiers.map((identifier) => identifier.trim());
    if (identifiers.some((identifier) => identifier.length < 3)) {
      setJoinConfirm((previous) => ({
        ...previous,
        error: `Enter all ${joinConfirm.playerCount} in-game names or UIDs to continue.`,
      }));
      return;
    }

    if (coins < joinConfirm.cost && !joinConfirm.isEditing) {
      setWalletMessage(`You need ${joinConfirm.cost - coins} more coins to join ${joinConfirm.mode}.`);
      setJoinConfirm(null);
      return;
    }

    const nextPurchasedCoins = joinConfirm.isEditing
      ? purchasedCoins
      : Math.max(0, purchasedCoins - joinConfirm.cost);
    const purchasedUsed = joinConfirm.isEditing
      ? 0
      : Math.min(purchasedCoins, joinConfirm.cost);
    const nextWinningCoins = joinConfirm.isEditing
      ? winningCoins
      : winningCoins - (joinConfirm.cost - purchasedUsed);
    const nextCoins = nextPurchasedCoins + nextWinningCoins;
    const nextJoinedMatches = joinConfirm.isEditing
      ? joinedMatches.map((entry) =>
          entry.id === joinConfirm.matchId
            ? { ...entry, mode: joinConfirm.mode, identifier: identifiers[0], identifiers }
            : entry,
        )
      : [...joinedMatches, {
          id: joinConfirm.matchId,
          mode: joinConfirm.mode,
          identifier: identifiers[0],
          identifiers,
          matchTimestamp: joinConfirm.matchTimestamp,
        }];

    setCoins(nextCoins);
    setPurchasedCoins(nextPurchasedCoins);
    setWinningCoins(nextWinningCoins);
    setJoinedMatches(nextJoinedMatches);
    void fetch("/api/matches/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: joinConfirm.matchId,
      publicId: joinConfirm.publicId,
      mode: joinConfirm.mode,
      matchTimestamp: joinConfirm.matchTimestamp,
        entryFee: joinConfirm.cost,
        teamKey: player?.email || player?.phone || player?.name,
        userKey: player?.email || player?.phone || player?.name,
      }),
    }).catch(() => {});

    setWalletMessage(
      joinConfirm.isEditing
        ? `${joinConfirm.mode} details updated for ${identifiers.join(", ")}.`
        : `${joinConfirm.mode} joined successfully for ${identifiers.join(", ")}. ${joinConfirm.cost.toLocaleString()} coins deducted.`,
    );
    setJoinConfirm(null);
  };

  const handleAuthSubmit = (event) => {
    event.preventDefault();
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
      const account = registeredUsers.find(
        (user) =>
          user[form.loginMethod] === loginValue && user.password === password,
      );
      if (!account) {
        setAuthError(
          "No account found with these credentials. Please sign up first.",
        );
        return;
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
      return;
    }

    const nextPlayer = {
      name: username.trim(),
      email: signupMethod === "email" ? email.trim().toLowerCase() : "",
      phone: signupMethod === "phone" ? phone.trim() : "",
      password,
      coins: 0,
    };
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

  const handleUpdateProfile = (name, email) => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (trimmedName.length < 3)
      return "Choose a gamer tag with at least 3 characters.";
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail))
      return "Enter a valid email address.";

    const nextPlayer = { ...player, name: trimmedName, email: trimmedEmail };
    const nextUsers = registeredUsers.map((user) => (
      user.email === player.email || user.phone === player.phone
        ? nextPlayer
        : user
    ));
    saveUserData(nextPlayer, { purchasedCoins, winningCoins, coins, joinedMatches });
    localStorage.setItem("nexus-player", JSON.stringify(nextPlayer));
    localStorage.setItem("nexus-registered-users", JSON.stringify(nextUsers));
    setRegisteredUsers(nextUsers);
    setPlayer(nextPlayer);
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
      setAdminOpen(false);
      setWalletOpen(false);
      setAuthOpen(false);
      setMenuOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.addEventListener("popstate", handleBrowserBack);
    return () => window.removeEventListener("popstate", handleBrowserBack);
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

  const submitPaymentProof = ({ utr, screenshotName }) => {
    if (!requireLogin() || !pendingPayment) return;
    const requests = JSON.parse(localStorage.getItem("nexus-payment-requests") || "[]");
    requests.push({ ...pendingPayment, utr, screenshotName, status: "pending", createdAt: new Date().toISOString(), user: player?.email || player?.phone || "guest" });
    localStorage.setItem("nexus-payment-requests", JSON.stringify(requests));
    void fetch("/api/payments/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userKey: player?.email || player?.phone || player?.name, amount: pendingPayment.amount, coins: pendingPayment.amount, utr }),
    }).catch(() => {});
    localStorage.removeItem("nexus-pending-payment");
    setPendingPayment(null);
    setManualUtr("");
    setWalletMessage("Payment proof submitted. Coins will be added after verification.");
  };

  const requestWithdrawal = (event) => {
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
    const remainingCoins = coins - amount;
    const remainingWinningCoins = winningCoins - amount;
    setCoins(remainingCoins);
    setWinningCoins(remainingWinningCoins);
    void fetch("/api/withdrawals/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userKey: player?.email || player?.phone || player?.name, amount, method: withdrawMethod, details: { ...withdrawDetails, qrScreenshotName: withdrawalScreenshot.name } }),
    }).catch(() => {});
    setWalletMessage(
      `Withdrawal request for ${amount.toLocaleString()} coins submitted.`,
    );
    setWithdrawAmount("");
    setWithdrawalScreenshot(null);
  };

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
          coinBalance={visibleCoins}
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
        <HeroSection openTournaments={openTournaments} registeredAccountCount={registeredUsers.length} />
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
        <div className="join-confirm-backdrop" role="dialog" aria-modal="true">
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
                  <p className="join-confirm-kicker">match briefing</p>
                  <h3>{matchDetails.mode}</h3>
                </div>
                <span className="match-detail-pill">{currentTime >= matchDetails.matchTimestamp ? "Live" : "Queued"}</span>
              </div>

              <div className="match-detail-banner">
                <div className="match-deta
                  il-banner-glow" />
                <img src={freeFireMaxIcon} alt="Free Fire MAX" />
                <div className="match-detail-banner-overlay">
                  <span>Squad arena</span>
                  <strong>Battle pass ready</strong>
                </div>
              </div>

              <div className="match-detail-grid">
                <div>
                  <span>Entry</span>
                  <strong>{matchDetails.entryFee.toLocaleString()} coins</strong>
                </div>
                <div>
                  <span>Start</span>
                  <strong>
                    {new Date(matchDetails.matchTimestamp).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </strong>
                </div>
                <div>
                  <span>Status</span>
                    <strong>{currentTime >= matchDetails.matchTimestamp ? "Started" : "Waiting"}</strong>
                </div>
              </div>

              <div className="brief-content">
                <p className="match-description">
                  {matchDetails.description || "This match is built for quick coordination, fair bracket timing, and instant room access for all confirmed players."}
                </p>
                {matchDetails.prizePool !== null && matchDetails.prizePool !== undefined && (
                  <div className="match-prize-box"><span>Prize pool</span><strong>{Number(matchDetails.prizePool).toLocaleString()} coins</strong></div>
                )}

                {matchDetails.joinedEntries?.length > 0 && (
                  <div className="match-player-list">
                    <span className="match-player-list-title">Joined teams</span>
                    {matchDetails.joinedEntries.map((team, teamIndex) => (
                      <div className="match-team-roster" key={`${team.id}-${teamIndex}`}>
                        <span className="match-team-label">Team {teamIndex + 1}</span>
                        <div>
                          {(team.identifiers || [team.identifier]).filter(Boolean).map((identifier, playerIndex) => (
                            <span className="match-player-name" key={`${identifier}-${playerIndex}`}>{identifier}</span>
                          ))}
                        </div>
                      </div>
                    ))}
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

                {matchDetails.joinedEntry ? (
                  currentTime < matchDetails.matchTimestamp ? (
                    <div className="room-info-box">
                      <div className="room-info-row">
                        <span>Room ID</span>
                        <strong>{matchDetails.roomId}</strong>
                      </div>
                      <div className="room-info-row">
                        <span>Password</span>
                        <strong>{matchDetails.password}</strong>
                      </div>
                    </div>
                  ) : (
                    <p className="match-detail-lock">This match has started, so room credentials are no longer visible.</p>
                  )
                ) : (
                  <p className="match-detail-lock">Join this match to unlock the room ID and password before the match starts.</p>
                )}
              </div>
            </div>

            <div className="join-confirm-actions">
              <button type="button" className="join-confirm-secondary" onClick={() => setMatchDetails(null)}>
                Close
              </button>
              {!matchDetails.joinedEntry && (
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
              This match will use <strong>{joinConfirm.cost.toLocaleString()} coins</strong> from your wallet.
            </p>
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
                    autoFocus={index === 0}
                  />
                </label>
              ))}
            </div>
            {joinConfirm.error && <p className="join-confirm-error">{joinConfirm.error}</p>}
            <div className="join-confirm-actions">
              <button type="button" className="join-confirm-secondary" onClick={() => setJoinConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="join-confirm-primary" onClick={confirmMatchJoin}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
