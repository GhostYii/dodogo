//! 密码哈希、令牌生成、AES-256-GCM 加密

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use base64::Engine;
use sha2::{Digest, Sha256};

use crate::error::AppError;

/// Argon2id 哈希密码（默认参数 m=19456, t=2, p=1）。
pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::encode_b64(&rand::random::<[u8; 16]>())
        .map_err(|e| AppError::Internal(anyhow::anyhow!("生成盐失败: {e}")))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(anyhow::anyhow!("密码哈希失败: {e}")))
}

/// 校验密码。
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// 生成 32 字节随机令牌（返回 hex 字符串）。
pub fn generate_token() -> String {
    hex::encode(rand::random::<[u8; 32]>())
}

/// SHA-256 哈希（hex）。
pub fn sha256_hex(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    hex::encode(digest)
}

/// 生成或加载 32 字节主密钥。
pub fn load_or_create_master_key(path: &std::path::Path) -> anyhow::Result<[u8; 32]> {
    if path.exists() {
        let hex_str = std::fs::read_to_string(path)?.trim().to_string();
        let bytes = hex::decode(&hex_str)?;
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        return Ok(key);
    }
    let key: [u8; 32] = rand::random();
    std::fs::write(path, hex::encode(key))?;
    Ok(key)
}

/// AES-256-GCM 加密，返回 base64(nonce || ciphertext)。
pub fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Internal(anyhow::anyhow!("加密初始化失败: {e}")))?;
    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Internal(anyhow::anyhow!("加密失败: {e}")))?;
    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(base64::engine::general_purpose::STANDARD.encode(combined))
}

/// AES-256-GCM 解密。
pub fn decrypt(key: &[u8; 32], encoded: &str) -> Result<String, AppError> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("解码失败: {e}")))?;
    if bytes.len() < 12 {
        return Err(AppError::Internal(anyhow::anyhow!("密文格式错误")));
    }
    let (nonce_bytes, ciphertext) = bytes.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| AppError::Internal(anyhow::anyhow!("解密初始化失败: {e}")))?;
    let mut nonce_arr = [0u8; 12];
    nonce_arr.copy_from_slice(nonce_bytes);
    let nonce = Nonce::from(nonce_arr);
    let plaintext = cipher
        .decrypt(&nonce, ciphertext)
        .map_err(|_| AppError::Internal(anyhow::anyhow!("令牌解密失败")))?;
    Ok(String::from_utf8_lossy(&plaintext).to_string())
}
