use super::init_tls_provider;
use futures_util::{SinkExt, StreamExt};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use std::{sync::Arc, time::Duration};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::{Error, Message};
use tokio_tungstenite::{accept_async, connect_async, connect_async_tls_with_config, Connector};

#[tokio::test]
async fn wss_exchanges_frames_with_trusted_certificate_and_rejects_unknown_issuer() {
    tokio::time::timeout(Duration::from_secs(10), async {
        init_tls_provider();
        let cert =
            CertificateDer::from(include_bytes!("../tests/fixtures/localhost-cert.der").to_vec());
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            include_bytes!("../tests/fixtures/localhost-key.der").to_vec(),
        ));
        let config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)
            .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "wss://127.0.0.1:{}/ws/agent",
            listener.local_addr().unwrap().port()
        );
        let fixture = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let tls = acceptor.accept(tcp).await.unwrap();
            let mut ws = accept_async(tls).await.unwrap();
            let auth = ws.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&auth).unwrap()["token"],
                "fixture-node-token"
            );
            ws.send(Message::Text("fixture-accepted".into()))
                .await
                .unwrap();
            drop(ws);
            let (tcp, _) = listener.accept().await.unwrap();
            assert!(
                acceptor.accept(tcp).await.is_err(),
                "untrusted certificate must fail TLS"
            );
        });
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(CertificateDer::from(
                include_bytes!("../tests/fixtures/ca.der").to_vec(),
            ))
            .unwrap();
        let client = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let (mut ws, _) = connect_async_tls_with_config(
            &url,
            None,
            false,
            Some(Connector::Rustls(Arc::new(client))),
        )
        .await
        .unwrap();
        ws.send(Message::Text(
            serde_json::json!({"token": "fixture-node-token"}).to_string(),
        ))
        .await
        .unwrap();
        assert_eq!(
            ws.next().await.unwrap().unwrap().into_text().unwrap(),
            "fixture-accepted"
        );
        drop(ws);
        // The production connector keeps its public roots and rejects our private test CA.
        let error = connect_async(&url).await.unwrap_err();
        let Error::Io(error) = error else {
            panic!("unexpected TLS failure: {error:?}");
        };
        assert!(
            matches!(
                error
                    .get_ref()
                    .and_then(|error| error.downcast_ref::<rustls::Error>()),
                Some(rustls::Error::InvalidCertificate(
                    rustls::CertificateError::UnknownIssuer
                ))
            ),
            "unexpected TLS failure: {error:?}"
        );
        fixture.await.unwrap();
    })
    .await
    .expect("WSS fixture timed out");
}
