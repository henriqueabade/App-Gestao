; build/installer.nsh

; 1) Garante que o NSIS procure includes no diretório build/
!addincludedir "${PROJECT_DIR}\\build"

; 2) Macros básicas de lógica (If, Else, VersionCompare, etc.)
!include "${NSISDIR}\\Include\\LogicLib.nsh"

; 3) Modern UI 2 (interface padrão do instalador)
!include "MUI2.nsh"

; 4) Seu arquivo local com o macro VersionCompare
!include "${PROJECT_DIR}\build\VersionCompare.nsh"

; 5) Seu preInit, usando VersionCompare sem erros
!macro preInit
  ReadRegStr $R0 HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${PRODUCT_NAME}" "DisplayVersion"
  ${If} $R0 != ""
    !insertmacro VersionCompare "$R0" "${VERSION}" $R1
    ${If} $R1 >= 0
      MessageBox MB_ICONEXCLAMATION "${PRODUCT_NAME} versão $R0 já está instalada. Instalação cancelada."
      Abort
    ${Else}
      MessageBox MB_ICONINFORMATION "Atualizando ${PRODUCT_NAME} de $R0 para ${VERSION}."
    ${EndIf}
  ${EndIf}
!macroend
