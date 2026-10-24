"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { exchangeKiroCallback } from "@/shared/utils/kiroCallback";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/**
 * Kiro Social OAuth Modal (Google/GitHub)
 * Handles manual callback URL flow for social login
 */
export default function KiroSocialOAuthModal({ isOpen, provider, onSuccess, onClose }) {
  const [step, setStep] = useState("loading"); // loading | input | success | error
  const [authUrl, setAuthUrl] = useState("");
  const authData = useRef(null);
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const { copied, copy } = useCopyToClipboard();
  const openedRef = useRef(false);

  // Reset auto-open guard when modal closes so it can re-open next session.
  useEffect(() => {
    if (!isOpen) openedRef.current = false;
  }, [isOpen]);

  // Initialize auth flow
  useEffect(() => {
    generation.current += 1;
    authData.current = null;
    if (!isOpen || !provider) return;
    let active = true;

    const initAuth = async () => {
      try {
        setError(null);
        setCallbackUrl("");
        setStep("loading");

        const res = await fetch(`/api/oauth/kiro/social-authorize?provider=${provider}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error);
        }

        if (!active) return;
        authData.current = { ...data, provider };
        setAuthUrl(data.authUrl);
        setStep("input");

        // Auto-open browser once per modal session.
        if (!openedRef.current) {
          openedRef.current = true;
          window.open(data.authUrl, "_blank");
        }
      } catch (err) {
        if (!active) return;
        setError(err.message);
        setStep("error");
      }
    };

    initAuth();
    return () => { active = false; generation.current += 1; authData.current = null; };
  }, [isOpen, provider, attempt]);

  const handleManualSubmit = async () => {
    if (step === "exchanging") return;
    const currentGeneration = generation.current;
    try {
      setError(null);
      setStep("exchanging");
      await exchangeKiroCallback(callbackUrl, authData, provider);

      if (generation.current !== currentGeneration) return;
      setStep("success");
      onSuccess?.();
    } catch (err) {
      if (generation.current !== currentGeneration) return;
      setError(err.message);
      setStep("error");
    }
  };

  const providerName = provider === "google" ? "Google" : "GitHub";

  return (
    <Modal isOpen={isOpen} title={`Connect Kiro via ${providerName}`} onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Loading */}
        {step === "loading" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Initializing...</h3>
            <p className="text-sm text-text-muted">
              Setting up {providerName} authentication
            </p>
          </div>
        )}

        {/* Manual Input Step */}
        {["input", "exchanging"].includes(step) && (
          <>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">Step 1: Open this URL in your browser</p>
                <div className="flex gap-2">
                  <Input value={authUrl} readOnly className="flex-1 font-mono text-xs" />
                  <Button 
                    variant="secondary" 
                    icon={copied === "auth_url" ? "check" : "content_copy"} 
                    onClick={() => copy(authUrl, "auth_url")}
                  >
                    Copy
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Step 2: Paste the callback URL here</p>
                <p className="text-xs text-text-muted mb-2">
                  After authorization, copy the full URL from your browser address bar.
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder="kiro://kiro.kiroAgent/authenticate-success?code=..."
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleManualSubmit} fullWidth disabled={!callbackUrl || step === "exchanging"}>
                Connect
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your Kiro account via {providerName} has been connected.
            </p>
            <Button onClick={onClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={() => authData.current ? setStep("input") : setAttempt(value => value + 1)} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

KiroSocialOAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.oneOf(["google", "github"]).isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
