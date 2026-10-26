// ads.js — Gestion des publicités AdMob

const AD_IDS = {
  banner: 'ca-app-pub-3940256099942544/2934735716',       // ID TEST iOS bannière
  interstitial: 'ca-app-pub-3940256099942544/4411468910', // ID TEST iOS interstitielle
  rewarded: 'ca-app-pub-3940256099942544/1712485313',
  // Remplacer par tes vrais ID une fois prêt :
  // banner: 'ca-app-pub-8425278698620884/3978191846',
  // interstitial: 'ca-app-pub-8425278698620884/8847375147',
  // Récompensée : 
};

const REWARD_EVENTS = {
  Loaded: 'onRewardedVideoAdLoaded',
  FailedToLoad: 'onRewardedVideoAdFailedToLoad',
  Showed: 'onRewardedVideoAdShowed',
  FailedToShow: 'onRewardedVideoAdFailedToShow',
  Dismissed: 'onRewardedVideoAdDismissed',
  Rewarded: 'onRewardedVideoAdReward',
};

let adsInitialized = false;



async function initAds() {
  if (adsInitialized) return true;

  const { AdMob } = Capacitor.Plugins;
  await AdMob.initialize({ initializeForTesting: true });

  let consentInfo;
  try {
    consentInfo = await AdMob.requestConsentInfo();
    if (consentInfo.isConsentFormAvailable && consentInfo.status === 'REQUIRED') {
      consentInfo = await AdMob.showConsentForm();
    }

    const boutonPref = document.getElementById('ads');
if (boutonPref) {
  boutonPref.style.display = consentInfo?.privacyOptionsRequirementStatus === 'REQUIRED' ? '' : 'none';
}


  } catch (err) {
    console.error('Erreur consentement RGPD:', err);
  }

  if (consentInfo && !consentInfo.canRequestAds) {
    console.log('Consentement non obtenu, pas de pubs demandées');
    adsInitialized = true;
    return false; // ← signale l'échec
  }

  if (window.Capacitor?.isNativePlatform()) {
    try {
      const trackingInfo = await AdMob.trackingAuthorizationStatus();
      if (trackingInfo.status === 'notDetermined') {
        await AdMob.requestTrackingAuthorization();
      }
    } catch (err) {
      console.error('Erreur ATT:', err);
    }
  }

  await AdMob.setRequestConfiguration({
    maxAdContentRating: 'T',
    tagForChildDirectedTreatment: false,
    tagForUnderAgeOfConsent: false,
  });

  adsInitialized = true;
  return true; // ← signale le succès
}

// --- Bannière ---
async function showBanner() {
  const ok = await initAds();
  if (!ok) return; // ← stoppe ici si pas de consentement, devient true si l'utilisateur accepte/refuse

  const { AdMob } = Capacitor.Plugins;
  try {
    await AdMob.showBanner({ adId: AD_IDS.banner, adSize: 'BANNER', position: 'BOTTOM_CENTER', margin: 0 });
  } catch (err) {
    console.error('Erreur affichage bannière:', err);
  }
}


async function hideBanner() {
  const { AdMob } = Capacitor.Plugins;
  try {
    await AdMob.hideBanner();
  } catch (err) {
    console.error('Erreur masquage bannière:', err);
  }
}

// --- Interstitielle ---

async function showInterstitial() {
  const ok = await initAds();
  if (!ok) return; // ← stoppe ici si pas de consentement, devient true si l'utilisateur accepte/refuse
  const { AdMob } = Capacitor.Plugins;

  try {
    await AdMob.prepareInterstitial({
      adId: AD_IDS.interstitial,
    });
    await AdMob.showInterstitial();
  } catch (err) {
    console.error('Erreur affichage interstitielle:', err);
  }
}



// --- Interstitielle avec listener ---

async function showInterstitialAndThen(ratio,isPremium,noAd,onDismissed) { // ratio : une chance sur tant d'afficher la pubs
    
    if(noAd || isPremium ||!window.Capacitor?.isNativePlatform() || ratio<0.5){
        if (onDismissed) onDismissed()
            return
    }
  await initAds();

  const { AdMob, InterstitialAdPluginEvents } = Capacitor.Plugins;

  // Écoute la fermeture de la pub AVANT de la lancer
  const listener = await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
    listener.remove(); // nettoie le listener après usage, évite les doublons
    if (onDismissed) onDismissed(); // exécute l'action demandée
  });

  try {
    await AdMob.prepareInterstitial({
      adId: AD_IDS.interstitial,
    });
    await AdMob.showInterstitial();
  } catch (err) {
    console.error('Erreur affichage interstitielle:', err);
    listener.remove(); // nettoyer aussi en cas d'échec de chargement
    if (onDismissed) onDismissed(); // fallback : continuer quand même si la pub échoue
  }
}

// --- Récompensées avec listener ---

// Renvoie true si l'utilisateur a bien gagné la récompense, sinon false
async function showRewarded() {
  if (!window.Capacitor?.isNativePlatform()) return false;

  const ok = await initAds();
  if (!ok) return false;   // pas de consentement

  const { AdMob } = Capacitor.Plugins;
  let rewarded = false;
  let done;
  const finished = new Promise((resolve) => (done = resolve));

  // Listeners AVANT de lancer la pub
  const handles = await Promise.all([
    AdMob.addListener(REWARD_EVENTS.Rewarded, () => { rewarded = true; }),
    AdMob.addListener(REWARD_EVENTS.Dismissed, () => done()),
    AdMob.addListener(REWARD_EVENTS.FailedToShow, () => done()),
  ]);

  try {
    await AdMob.prepareRewardVideoAd({ adId: AD_IDS.rewarded });
    await AdMob.showRewardVideoAd();
    await finished;                       // attend la fermeture de la pub
  } catch (err) {
    console.error('Erreur pub récompensée:', err);
  } finally {
    handles.forEach((h) => h.remove());   // évite les doublons
  }
  return rewarded;
}

// --- Gestion du consentement RGPD (lien de révocation) ---

async function showPrivacyOptions() {
  if (!window.Capacitor?.isNativePlatform()) {
    console.warn('showPrivacyOptions : indisponible hors app native');
    return;
  }

  const { AdMob } = Capacitor.Plugins;
  try {
    await AdMob.showPrivacyOptionsForm();
  } catch (err) {
    console.error('Erreur affichage options confidentialité:', err);
  }
}
