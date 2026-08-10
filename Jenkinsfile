// pipeline {
//     agent {
//         // Replace with trehe label you assigned to this specific SSH agent in Jenkins
//         label 'codeql1' 
//     }

//     environment {
//         PATH = "/opt/codeql:${env.PATH}"
//         // Change this to the language of your repository 
//         // Options: c-cpp, csharp, go, java-kotlin, javascript-typescript, python, ruby, swift
//         CODEQL_LANG = 'javascript-typescript'
        
//         DB_DIR      = 'codeql-db'
//         REPORT_DIR  = 'codeql-reports'
//     }

//     stages {
//         stage('Setup and Clean') {
//             steps {
//                 echo "Verifying CodeQL Installation..."
//                 sh 'codeql version'
                
//                 // Clean up any old analysis artifacts
//                 sh "rm -rf ${DB_DIR} ${REPORT_DIR}"
//                 sh "mkdir -p ${REPORT_DIR}"
//             }
//         }

//         stage('CodeQL Database Initialization') {
//             steps {
//                 echo "Creating CodeQL database for ${CODEQL_LANG}..."
                
//                 // For interpreted languages (Python, JS, Ruby), CodeQL extracts automatically.
//                 // For compiled languages (Java, C++, C#), see the tuning note below.
//                 sh """
//                     codeql database create ${DB_DIR} \
//                         --language=${CODEQL_LANG} \
//                         --source-root .
//                 """
//             }
//         }

//         stage('CodeQL Analysis') {
//             steps {
//                 echo "Running CodeQL analysis..."
//                 sh "mkdir -p codeql-reports"
                
//                 // This command downloads the standard security query pack and runs it
//                 sh """
                        

//                         codeql database analyze ${DB_DIR} \
//                             codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls \
//                             --format=sarif-latest  \
//                             --output=codeql-reports/results.sarif
//                     """
//             }
//         }
//     }

//     post {
//         always {
//             // Archive the SARIF report so you can download/view it from the Jenkins UI
//             echo "Archiving analysis results..."
//             archiveArtifacts artifacts: "${REPORT_DIR}/*", fingerprint: true
//         }
//         success {
//             echo "CodeQL analysis completed successfully!"
//         }
//         failure {
//             echo "Pipeline failed. Check the build logs."
//         }
//     }
// }

////////////////////////////////////////
pipeline {
agent none
environment {
    SEMGREP_APP_TOKEN = credentials('SEMGREP_APP_TOKEN')

    SEMGREP_PR_ID     = "${env.CHANGE_ID}"
    SEMGREP_JOB_URL   = "${BUILD_URL}"
    SEMGREP_COMMIT    = "${GIT_COMMIT}"
    SEMGREP_BRANCH    = "${GIT_BRANCH}"
}

stages {

    stage('Semgrep') {
        agent {
            label 'semgrep1'
        }

        steps {
            checkout scm

            sh '''
                set -e

                echo "================================"
                echo "Running Semgrep"
                echo "================================"

                echo "User:"
                whoami

                echo "Semgrep:"
                which semgrep
                semgrep --version

                git config --global --add safe.directory "$(pwd)"

                rm -rf semgrep-reports
                mkdir -p semgrep-reports

                echo "Running Semgrep scan..."

                semgrep ci \
                    --sarif \
                    --output semgrep-reports/results.sarif

                echo "Semgrep report:"
                ls -lh semgrep-reports/results.sarif
            '''
        }

        post {
            always {
                echo "Archiving Semgrep results..."

                archiveArtifacts(
                    artifacts: 'semgrep-reports/results.sarif',
                    fingerprint: true,
                    allowEmptyArchive: true
                )
            }
        }
    }

   
}

}
