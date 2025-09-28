(define-constant ERR_CAMPAIGN_EXISTS u100)
(define-constant ERR_UNAUTHORIZED u101)
(define-constant ERR_INVALID_ID u102)
(define-constant ERR_INVALID_REGION u103)
(define-constant ERR_INVALID_VACCINE_TYPE u104)
(define-constant ERR_INVALID_POPULATION u105)
(define-constant ERR_INVALID_TIMESTAMP u106)
(define-constant ERR_AUTHORITY_NOT_VERIFIED u107)
(define-constant ERR_INVALID_STATUS u108)
(define-constant ERR_MAX_CAMPAIGNS_EXCEEDED u109)
(define-constant ERR_INVALID_METADATA u110)

(define-data-var next-campaign-id uint u0)
(define-data-var max-campaigns uint u1000)
(define-data-var creation-fee uint u1000)
(define-data-var authority-contract (optional principal) none)

(define-map campaigns
  { campaign-id: (string-ascii 64) }
  {
    region: (string-ascii 100),
    vaccine-type: (string-ascii 50),
    target-population: uint,
    creator: principal,
    created-at: uint,
    status: bool,
    metadata: (string-utf8 256)
  }
)

(define-map campaigns-by-region
  { region: (string-ascii 100) }
  { campaign-ids: (list 100 (string-ascii 64)) }
)

(define-map campaign-updates
  { campaign-id: (string-ascii 64) }
  {
    update-region: (string-ascii 100),
    update-vaccine-type: (string-ascii 50),
    update-target-population: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-campaign (campaign-id (string-ascii 64)))
  (map-get? campaigns { campaign-id: campaign-id })
)

(define-read-only (get-campaign-updates (campaign-id (string-ascii 64)))
  (map-get? campaign-updates { campaign-id: campaign-id })
)

(define-read-only (get-campaigns-by-region (region (string-ascii 100)))
  (default-to { campaign-ids: (list ) } (map-get? campaigns-by-region { region: region }))
)

(define-read-only (is-campaign-registered (campaign-id (string-ascii 64)))
  (is-some (map-get? campaigns { campaign-id: campaign-id }))
)

(define-private (validate-campaign-id (campaign-id (string-ascii 64)))
  (if (and (> (len campaign-id) u0) (<= (len campaign-id) u64))
      (ok true)
      (err ERR_INVALID_ID))
)

(define-private (validate-region (region (string-ascii 100)))
  (if (and (> (len region) u0) (<= (len region) u100))
      (ok true)
      (err ERR_INVALID_REGION))
)

(define-private (validate-vaccine-type (vaccine-type (string-ascii 50)))
  (if (and (> (len vaccine-type) u0) (<= (len vaccine-type) u50))
      (ok true)
      (err ERR_INVALID_VACCINE_TYPE))
)

(define-private (validate-target-population (population uint))
  (if (> population u0)
      (ok true)
      (err ERR_INVALID_POPULATION))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR_INVALID_TIMESTAMP))
)

(define-private (validate-metadata (metadata (string-utf8 256)))
  (if (<= (len metadata) u256)
      (ok true)
      (err ERR_INVALID_METADATA))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR_UNAUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR_AUTHORITY_NOT_VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-campaigns (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR_MAX_CAMPAIGNS_EXCEEDED))
    (asserts! (is-some (var-get authority-contract)) (err ERR_AUTHORITY_NOT_VERIFIED))
    (var-set max-campaigns new-max)
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR_INVALID_METADATA))
    (asserts! (is-some (var-get authority-contract)) (err ERR_AUTHORITY_NOT_VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (register-campaign
  (campaign-id (string-ascii 64))
  (region (string-ascii 100))
  (vaccine-type (string-ascii 50))
  (target-population uint)
  (metadata (string-utf8 256))
)
  (let (
      (next-id (var-get next-campaign-id))
      (current-max (var-get max-campaigns))
      (authority (var-get authority-contract))
      (region-data (get-campaigns-by-region region))
      (updated-campaign-ids (unwrap! (as-max-len? (append (get campaign-ids region-data) campaign-id) u100) (err ERR_MAX_CAMPAIGNS_EXCEEDED)))
    )
    (asserts! (< next-id current-max) (err ERR_MAX_CAMPAIGNS_EXCEEDED))
    (try! (validate-campaign-id campaign-id))
    (try! (validate-region region))
    (try! (validate-vaccine-type vaccine-type))
    (try! (validate-target-population target-population))
    (try! (validate-metadata metadata))
    (asserts! (is-none (map-get? campaigns { campaign-id: campaign-id })) (err ERR_CAMPAIGN_EXISTS))
    (asserts! (is-some authority) (err ERR_AUTHORITY_NOT_VERIFIED))
    (try! (stx-transfer? (var-get creation-fee) tx-sender (unwrap! authority (err ERR_AUTHORITY_NOT_VERIFIED))))
    (map-set campaigns { campaign-id: campaign-id }
      {
        region: region,
        vaccine-type: vaccine-type,
        target-population: target-population,
        creator: tx-sender,
        created-at: block-height,
        status: true,
        metadata: metadata
      }
    )
    (map-set campaigns-by-region { region: region } { campaign-ids: updated-campaign-ids })
    (var-set next-campaign-id (+ next-id u1))
    (print { event: "campaign-registered", id: campaign-id })
    (ok campaign-id)
  )
)

(define-public (update-campaign
  (campaign-id (string-ascii 64))
  (update-region (string-ascii 100))
  (update-vaccine-type (string-ascii 50))
  (update-target-population uint)
)
  (let (
      (campaign (map-get? campaigns { campaign-id: campaign-id }))
      (old-region (get region (unwrap! campaign (err ERR_CAMPAIGN_EXISTS))))
      (old-campaign-ids (get campaign-ids (get-campaigns-by-region old-region)))
      (new-campaign-ids (unwrap! (as-max-len? (append (get campaign-ids (get-campaigns-by-region update-region)) campaign-id) u100) (err ERR_MAX_CAMPAIGNS_EXCEEDED)))
    )
    (asserts! (is-some campaign) (err ERR_CAMPAIGN_EXISTS))
    (asserts! (is-eq (get creator (unwrap! campaign (err ERR_CAMPAIGN_EXISTS))) tx-sender) (err ERR_UNAUTHORIZED))
    (try! (validate-region update-region))
    (try! (validate-vaccine-type update-vaccine-type))
    (try! (validate-target-population update-target-population))
    (map-set campaigns { campaign-id: campaign-id }
      {
        region: update-region,
        vaccine-type: update-vaccine-type,
        target-population: update-target-population,
        creator: (get creator (unwrap! campaign (err ERR_CAMPAIGN_EXISTS))),
        created-at: (get created-at (unwrap! campaign (err ERR_CAMPAIGN_EXISTS))),
        status: (get status (unwrap! campaign (err ERR_CAMPAIGN_EXISTS))),
        metadata: (get metadata (unwrap! campaign (err ERR_CAMPAIGN_EXISTS)))
      }
    )
    (map-set campaign-updates { campaign-id: campaign-id }
      {
        update-region: update-region,
        update-vaccine-type: update-vaccine-type,
        update-target-population: update-target-population,
        update-timestamp: block-height,
        updater: tx-sender
      }
    )
    (map-set campaigns-by-region { region: old-region }
      { campaign-ids: (filter (lambda (id) (not (is-eq id campaign-id))) old-campaign-ids) }
    )
    (map-set campaigns-by-region { region: update-region } { campaign-ids: new-campaign-ids })
    (print { event: "campaign-updated", id: campaign-id })
    (ok true)
  )
)

(define-public (get-campaign-count)
  (ok (var-get next-campaign-id))
)