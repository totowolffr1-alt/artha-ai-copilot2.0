"""
apps/dashboard/model.py
Artha AI — XAI Model Engine

Trains an XGBoost classifier on historical signal data.
Computes:
  - Prediction confidence (predict_proba)
  - SHAP feature attribution values (TreeExplainer)
  - Regime-conditional SHAP analysis (bull vs bear vs volatile)
"""

import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.preprocessing import LabelEncoder
import warnings

warnings.filterwarnings("ignore")

# Feature columns used for model training
FEATURE_COLS = ["rsi", "macd", "macd_signal", "atr", "volume_ratio"]

# Optional feature: Bollinger Band width (derived)
def _enrich_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    # BB width as pct of midpoint
    if "bb_upper" in df.columns and "bb_lower" in df.columns:
        mid = (df["bb_upper"] + df["bb_lower"]) / 2
        df["bb_width_pct"] = ((df["bb_upper"] - df["bb_lower"]) / mid.replace(0, np.nan)).fillna(0)
    else:
        df["bb_width_pct"] = 0.0
    return df


def _get_feature_cols(df: pd.DataFrame):
    """Return the feature columns that are present in the DataFrame."""
    cols = FEATURE_COLS.copy()
    if "bb_width_pct" in df.columns:
        cols.append("bb_width_pct")
    return [c for c in cols if c in df.columns]


class ArthaXAIModel:
    """
    XGBoost-based directional classifier with SHAP explainability.
    Predicts probability of an upward price move (direction=1).
    """

    def __init__(self):
        self.model: xgb.XGBClassifier | None = None
        self.explainer: shap.TreeExplainer | None = None
        self.feature_cols: list[str] = []
        self.label_encoder = LabelEncoder()
        self.is_trained = False

    def train(self, df: pd.DataFrame) -> dict:
        """
        Train the XGBoost model on the provided signal DataFrame.
        Returns evaluation metrics dict.
        """
        df = _enrich_features(df.dropna(subset=["direction"]))
        self.feature_cols = _get_feature_cols(df)

        X = df[self.feature_cols].fillna(0)
        y = df["direction"].astype(int)

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        self.model = xgb.XGBClassifier(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            use_label_encoder=False,
            eval_metric="logloss",
            random_state=42,
        )
        self.model.fit(
            X_train, y_train,
            eval_set=[(X_test, y_test)],
            verbose=False,
        )

        # Build SHAP TreeExplainer
        self.explainer = shap.TreeExplainer(self.model)
        self.is_trained = True

        # Metrics
        y_proba = self.model.predict_proba(X_test)[:, 1]
        y_pred  = (y_proba >= 0.5).astype(int)
        roc_auc = roc_auc_score(y_test, y_proba)
        report  = classification_report(y_test, y_pred, output_dict=True)

        return {
            "roc_auc": round(roc_auc, 4),
            "precision": round(report["1"]["precision"], 4),
            "recall": round(report["1"]["recall"], 4),
            "f1": round(report["1"]["f1-score"], 4),
            "train_size": len(X_train),
            "test_size": len(X_test),
        }

    def predict_with_confidence(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Run inference on a DataFrame. Appends ml_confidence and ml_direction columns.
        ml_confidence = P(up | features)
        """
        if not self.is_trained or self.model is None:
            raise RuntimeError("Model not trained. Call train() first.")
        df = _enrich_features(df.copy())
        X = df[self.feature_cols].fillna(0)
        proba = self.model.predict_proba(X)[:, 1]
        df["ml_confidence"] = proba.round(4)
        df["ml_direction"]  = (proba >= 0.5).astype(int)
        return df

    def compute_shap_values(self, df: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
        """
        Compute SHAP values for each row in df.
        Returns:
          shap_values: ndarray of shape (n_samples, n_features)
          X: the feature DataFrame used
        """
        if not self.is_trained or self.explainer is None:
            raise RuntimeError("Model not trained. Call train() first.")
        df = _enrich_features(df.copy())
        X = df[self.feature_cols].fillna(0)
        shap_values = self.explainer.shap_values(X)
        return shap_values, X

    def shap_summary_by_regime(
        self,
        df: pd.DataFrame,
        regime_col: str = "regime"
    ) -> dict[str, pd.DataFrame]:
        """
        Regime-conditional SHAP: compute mean |SHAP| per feature
        for each market regime present in the data.
        Returns a dict: { regime_name -> DataFrame of (feature, mean_abs_shap) }
        """
        if regime_col not in df.columns:
            return {}

        df = _enrich_features(df.copy())
        results: dict[str, pd.DataFrame] = {}

        for regime in df[regime_col].dropna().unique():
            subset = df[df[regime_col] == regime]
            if len(subset) < 5:
                continue
            X_sub = subset[self.feature_cols].fillna(0)
            sv = self.explainer.shap_values(X_sub)
            mean_abs = np.abs(sv).mean(axis=0)
            results[regime] = pd.DataFrame({
                "feature": self.feature_cols,
                "mean_abs_shap": mean_abs.round(5),
            }).sort_values("mean_abs_shap", ascending=False)

        return results

    def get_feature_importance(self) -> pd.DataFrame:
        """Returns global feature importance from XGBoost gain scores."""
        if not self.is_trained or self.model is None:
            raise RuntimeError("Model not trained.")
        importance = self.model.get_booster().get_score(importance_type="gain")
        df = pd.DataFrame(importance.items(), columns=["feature", "gain"])
        return df.sort_values("gain", ascending=False).reset_index(drop=True)
