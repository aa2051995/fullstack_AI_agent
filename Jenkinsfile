pipeline {
    agent {
        label 'codeql1'
    }

    environment {
        PATH = "/opt/codeql:${env.PATH}"
        CODEQL_LANG = 'javascript-typescript'

        DB_DIR     = 'codeql-db'
        REPORT_DIR = 'codeql-reports'

        // Use one shared cache path on the agent so every PR build resolves packs the same way.
        CODEQL_CACHE = '/home/jenkins/.codeql'
        CODEQL_PACK  = 'codeql/javascript-queries'
        CODEQL_SUITE = 'codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls'
    }

    stages {
        stage('Setup and Clean') {
            steps {
                sh '''
                    set -e
                    codeql version
                    mkdir -p "$CODEQL_CACHE" "$REPORT_DIR"
                    rm -rf "$DB_DIR" "$REPORT_DIR"
                    mkdir -p "$CODEQL_CACHE" "$REPORT_DIR"
                '''
            }
        }

        stage('Ensure CodeQL Pack Is Available') {
            steps {
                sh '''
                    set -e
                    codeql pack download "$CODEQL_PACK" --common-caches="$CODEQL_CACHE"
                    codeql resolve packs --common-caches="$CODEQL_CACHE" || true
                '''
            }
        }

        stage('CodeQL Database Initialization') {
            steps {
                sh '''
                    set -e
                    codeql database create "$DB_DIR" \
                        --language="$CODEQL_LANG" \
                        --source-root .
                '''
            }
        }

        stage('CodeQL Analysis') {
            steps {
                sh '''
                    set -e
                    codeql database analyze "$DB_DIR" "$CODEQL_SUITE" \
                        --common-caches="$CODEQL_CACHE" \
                        --format=sarif-latest \
                        --output="$REPORT_DIR/results.sarif"
                '''
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: "${REPORT_DIR}/*", fingerprint: true
        }
    }
}